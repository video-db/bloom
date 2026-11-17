// The recorder, in the SDK's standalone mode: a recording is a file on this Mac, made with
// no backend session or token. This adapter records, then sends the finished file to
// VideoDB itself, and keeps its own list of files so an unfinished one is found again after
// a restart. File paths stay in this module; the engine and the windows only ever see ids.
// All SDK recorder calls and native event names are confined to this file (ADR 0005).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ServiceError, request } = require('./errors');
const { atomicWrite } = require('./files');

// What standalone capture accepts for sound: the system's default devices only.
// The recorder keeps each recording in a folder of its own: the stop result's `path` is
// that folder and the video is one of its `files`. Returns the video file itself, or ''
// when there is none. A stored folder (from before this was known) resolves the same way.
function videoFile(folder, files = []) {
  const isVideo = (name) => /\.mp4$/i.test(name);
  const listed = (Array.isArray(files) ? files : [])
    .filter((name) => typeof name === 'string' && isVideo(name))
    .map((name) =>
      path.isAbsolute(name) ? name : path.join(folder || '', name),
    );
  if (listed.length) return listed[0];
  if (!folder || isVideo(folder)) return folder || '';
  try {
    if (!fs.statSync(folder).isDirectory()) return folder;
    const videos = fs.readdirSync(folder).filter(isVideo);
    const video = videos.includes('recording.mp4')
      ? 'recording.mp4'
      : videos[0];
    return video ? path.join(folder, video) : '';
  } catch {
    return '';
  }
}

// Where the recorder keeps its recordings when nothing else says: one folder each, named
// by the recording's id, with media.json marking a file that was finished.
const RECORDER_HOME = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'videodb-recorder',
  'recordings',
);
// A finished recording's video in `root`, or '' when there is none that is complete.
function finishedIn(root, recordingId) {
  const folder = path.join(root, recordingId);
  try {
    const media = JSON.parse(
      fs.readFileSync(path.join(folder, 'media.json'), 'utf8'),
    );
    return media?.complete === true ? videoFile(folder) : '';
  } catch {
    return '';
  }
}

const MIC = { id: 'mic:default', name: 'Microphone' };
const SYSTEM_AUDIO = { id: 'system_audio:default', name: 'System audio' };
const NATIVE_EVENTS = ['shutdown', 'error', 'window-closed', 'window-switched'];

function createLocalRecorder({
  CaptureClient,
  service,
  journalFile,
  permissionStatus,
  permissionDecided = () => true,
  askMicrophone = null, // Bloom's own process asks for the microphone, when it can
  recorderHome = RECORDER_HOME, // where a recording is looked for when its path is unknown
}) {
  const events = new EventEmitter();
  const sending = new Map(); // recordingId -> promise of the completion payload
  let client = null;
  let active = null; // { recordingId, sessionId } while capturing
  let micAllowed = false; // the person said yes to Bloom's own microphone question

  // ---- the list of files: recordingId -> { sessionId, scopeId, path, title, stage, videoId }
  let entries = {};
  if (journalFile && fs.existsSync(journalFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
      if (saved?.version === 1 && saved.entries) entries = saved.entries;
    } catch {
      // An unreadable list is kept on disk beside a fresh one; files are never deleted here.
      fs.copyFileSync(journalFile, `${journalFile}.unreadable-${Date.now()}`);
    }
  }
  // A capture that was under way when Bloom last closed has no finished file to send.
  for (const [id, entry] of Object.entries(entries))
    if (!entry.path && entry.stage !== 'failed')
      entries[id] = { ...entry, stage: 'failed' };
  const save = () => {
    if (!journalFile) return;
    try {
      atomicWrite(journalFile, JSON.stringify({ version: 1, entries }));
    } catch {
      // The list still holds in memory for this run; the recording itself is not at risk.
    }
  };
  const update = (recordingId, patch) => {
    entries = {
      ...entries,
      [recordingId]: { ...entries[recordingId], ...patch },
    };
    save();
  };
  const scope = () => service.cachedIdentity?.()?.scopeId || null;
  const identity = (recordingId) => ({
    recordingId,
    sessionId: entries[recordingId]?.sessionId,
  });
  const completion = (recordingId) => ({
    ...identity(recordingId),
    result: { videoId: entries[recordingId].videoId },
  });

  function ensure() {
    if (!client) {
      const instance = new CaptureClient(); // standalone: no credentials
      for (const name of NATIVE_EVENTS)
        instance.on(name, (payload) => {
          if (client === instance) events.emit('event', name, payload);
        });
      client = instance;
    }
    return client;
  }

  // Send a finished file to VideoDB. One attempt at a time per recording.
  function send(recordingId) {
    let entry = entries[recordingId];
    // A recording whose Stop never answered, or that was being made when Bloom closed,
    // has no known file. The recorder may have finished it all the same: look where it
    // keeps them, beside the other recordings and in its usual place.
    if (entry && !entry.path) {
      const roots = [
        ...Object.values(entries)
          .filter((other) => other.path)
          .map((other) =>
            path.dirname(path.dirname(videoFile(other.path) || other.path)),
          ),
        recorderHome,
      ];
      const found = roots
        .map((root) => finishedIn(root, recordingId))
        .find(Boolean);
      if (found) {
        update(recordingId, { path: found });
        entry = entries[recordingId];
      }
    }
    // What is sent is the video itself, never the folder it is kept in.
    const file = entry?.path ? videoFile(entry.path) : '';
    if (entry?.path && file && file !== entry.path) {
      update(recordingId, { path: file });
      entry = entries[recordingId];
    }
    if (!file) {
      if (entry) {
        update(recordingId, { stage: 'failed' });
        events.emit('event', 'recording-relay-failed', identity(recordingId));
      }
      return Promise.reject(
        new ServiceError(
          'not-found',
          'This recording can no longer be recovered.',
        ),
      );
    }
    if (entry.stage === 'complete')
      return Promise.resolve(completion(recordingId));
    if (sending.has(recordingId)) return sending.get(recordingId);
    update(recordingId, { stage: 'uploading' });
    const attempt = service
      .uploadRecording({ path: entry.path, title: entry.title })
      .then((video) => {
        update(recordingId, { stage: 'complete', videoId: video.id });
        const payload = completion(recordingId);
        events.emit('event', 'processing-complete', payload);
        return payload;
      })
      .catch((error) => {
        update(recordingId, { stage: 'failed' });
        events.emit('event', 'recording-relay-failed', identity(recordingId));
        throw error;
      })
      .finally(() => sending.delete(recordingId));
    sending.set(recordingId, attempt);
    return attempt;
  }
  const idFor = ({ recordingId, sessionId }) =>
    recordingId ||
    Object.keys(entries).find((id) => entries[id].sessionId === sessionId);

  return {
    onEvent(listener) {
      events.on('event', listener);
      return () => events.off('event', listener);
    },
    permissions() {
      return {
        screen: permissionStatus('screen'),
        mic: micAllowed || permissionStatus('microphone'),
        // macOS has an answer for the microphone: allowed or refused, not still asking.
        micDecided: micAllowed || permissionDecided('microphone'),
        camera: false,
      };
    },
    async requestPermission(key) {
      if (key !== 'screen' && askMicrophone) {
        // The answer to the question is the status; macOS's own reading can lag behind it.
        micAllowed = (await askMicrophone()) === true;
        return this.permissions();
      }
      await request(() =>
        ensure().requestPermission(
          key === 'screen' ? 'screen-capture' : 'microphone',
        ),
      );
      return this.permissions();
    },
    async channels() {
      const groups = await request(() => ensure().listChannels());
      return {
        displays: Array.from(groups.displays || []).map((c) => ({
          id: c.id,
          name: c.name,
        })),
        mics: Array.from(groups.mics || []).length ? [MIC] : [],
        systemAudio: Array.from(groups.systemAudio || []).length
          ? [SYSTEM_AUDIO]
          : [],
      };
    },
    // The windows that can be recorded right now. Bloom's own are left out, and so are
    // windows that are not on screen, which cannot be captured.
    async windows() {
      const found = await request(() => ensure().getWindows());
      return {
        supported: !!(found?.supported && found.supportsDeferredWindow),
        windows: Array.from(found?.windows || [])
          .filter(
            (w) =>
              w.isOnScreen &&
              w.bundleId !== 'com.videodb.bloom' &&
              w.appName !== 'Bloom',
          )
          .map((w) => ({
            id: w.channelId,
            app: w.appName || 'App',
            title: w.title || 'Untitled window',
            width: w.width,
            height: w.height,
          })),
      };
    },
    // While recording a window: move to another one, or blank it with a plain card.
    switchWindow: (id) =>
      request(() => ensure().switchWindow({ channelId: id }), {
        mutation: true,
      }),
    setWindowEnabled: (enabled) =>
      request(() => ensure().setWindowEnabled({ enabled }), { mutation: true }),
    // Delete a recording's file once it is ready in VideoDB (ADR 0006), and forget it.
    // Only a recording that was sent and confirmed is ever discarded; only Bloom's own
    // folder for it is removed. True when nothing of it is left here.
    discard(recordingId) {
      const entry = entries[recordingId];
      if (!entry) return true;
      if (entry.stage !== 'complete' || !entry.videoId) return false;
      try {
        const file = entry.path ? videoFile(entry.path) || entry.path : '';
        if (file) {
          const folder = fs
            .statSync(file, { throwIfNoEntry: false })
            ?.isDirectory()
            ? file
            : path.dirname(file);
          // The recorder keeps each recording in a folder named by its id. Anything else
          // is not ours to remove whole: there, only the video file itself goes.
          if (path.basename(folder) === recordingId)
            fs.rmSync(folder, { recursive: true, force: true });
          else if (/\.mp4$/i.test(file)) fs.rmSync(file, { force: true });
        }
      } catch {
        return false; // tried again the next time this recording is seen
      }
      const rest = { ...entries };
      delete rest[recordingId];
      entries = rest;
      save();
      return true;
    },
    // Recordings of this account that are not finished: found again after a restart.
    async recover() {
      const current = scope();
      return Object.entries(entries)
        .filter(([, entry]) => entry.scopeId === current)
        .map(([recordingId, entry]) => ({
          recordingId,
          sessionId: entry.sessionId,
          stage:
            entry.stage === 'complete'
              ? 'complete'
              : entry.stage === 'failed'
                ? 'failed'
                : entry.stage === 'recording'
                  ? 'recording'
                  : 'processing',
          ...(entry.stage === 'complete'
            ? { result: { videoId: entry.videoId } }
            : {}),
        }));
    },
    async start({ sessionId, channels, title }) {
      if (!scope())
        throw new ServiceError(
          'signed-out',
          'Connect your VideoDB account first.',
        );
      let refusal = null; // the recorder answered, and the answer was no
      let started;
      try {
        started = await request(
          async () => {
            try {
              return await ensure().startLocalRecording({
                channels: channels.map(({ channelId, type }) => ({
                  channelId,
                  type,
                })),
              });
            } catch (error) {
              if (error?.name === 'CaptureCommandError') refusal = error;
              throw error;
            }
          },
          { timeoutMs: 315000, mutation: true },
        );
      } catch (error) {
        if (!refusal) throw error; // no answer: capture may or may not have begun
        // Nothing is being recorded, so Start can simply be pressed again.
        throw Object.assign(
          new ServiceError(
            'recorder-refused',
            refusal.code === 'TARGET_NOT_FOUND'
              ? 'That window or display is no longer available. Choose what to record again.'
              : 'Recording could not start. Check that Bloom may record the screen in System Settings, then try again.',
          ),
          { refused: true },
        );
      }
      active = { recordingId: started.recordingId, sessionId };
      update(started.recordingId, {
        sessionId,
        scopeId: scope(),
        title,
        stage: 'recording',
        createdAt: Date.now(),
      });
    },
    // Finalises the file, says so, and starts sending it. Resolves once capture has ended:
    // with the file safe, or with the recording marked failed if it could not be finished.
    // Throws only while capture may still be running, so Stop can be tried again.
    async stop() {
      const recordingId = active?.recordingId;
      let result;
      let ended = false; // read from the SDK's own error, before it is made safe to show
      try {
        result = await request(
          async () => {
            try {
              return await ensure().stopLocalRecording();
            } catch (error) {
              ended =
                error?.code === 'FINALIZE_FAILED' ||
                /no standalone recording is active/i.test(
                  String(error?.message),
                );
              throw error;
            }
          },
          { timeoutMs: 160000, mutation: true },
        );
      } catch (error) {
        // The recorder says nothing is being recorded, and Bloom knew of nothing either:
        // there is no capture to stop and no file to wait for.
        if (ended && !recordingId) return { nothing: true };
        if (!ended) throw error;
        // The engine learns of it when it waits for this recording, once Stop has returned.
        active = null;
        update(recordingId, { stage: 'failed' });
        return;
      }
      const id = recordingId || result.recordingId;
      active = null;
      update(id, {
        path: videoFile(result.path, result.files) || result.path,
        stage: 'ready',
      });
      events.emit('event', 'local-recording-ready', {
        ...identity(id),
        stage: 'processing',
        metadata: { duration_seconds: result.durationSeconds },
      });
      send(id).catch(() => {}); // the outcome arrives as an event
    },
    pause: (tracks) =>
      request(() => ensure().pauseTracks(tracks), { mutation: true }),
    resume: (tracks) =>
      request(() => ensure().resumeTracks(tracks), { mutation: true }),
    // Try sending a recording again. Resolves once the attempt has begun.
    async relay(recordingId) {
      if (!entries[recordingId])
        throw new ServiceError(
          'not-found',
          'This recording was made by an earlier version of Bloom and cannot be recovered here.',
        );
      // Already in VideoDB: say so again and send nothing.
      if (
        entries[recordingId].stage === 'complete' &&
        entries[recordingId].videoId
      ) {
        events.emit('event', 'processing-complete', completion(recordingId));
        return;
      }
      if (entries[recordingId].path) update(recordingId, { stage: 'ready' });
      send(recordingId).catch(() => {});
    },
    // Resolves when the recording is in VideoDB; starts sending it if nothing is.
    async wait(target) {
      const recordingId = idFor(target);
      if (!recordingId || !entries[recordingId])
        throw new ServiceError(
          'not-found',
          'This recording is not known here.',
        );
      if (entries[recordingId].stage === 'failed')
        throw new ServiceError('unavailable', 'Processing did not finish.');
      // Still capturing or being finalised: its turn comes when Stop has the file.
      if (!entries[recordingId].path && active?.recordingId !== recordingId)
        throw new ServiceError('unavailable', 'Processing did not finish.');
      if (!entries[recordingId].path)
        return new Promise((resolve, reject) => {
          const off = this.onEvent((name, payload) => {
            if (payload?.recordingId !== recordingId) return;
            if (name === 'processing-complete') resolve(payload);
            else if (
              ['recording-relay-failed', 'local-recording-failed'].includes(
                name,
              )
            )
              reject(
                new ServiceError('unavailable', 'Processing did not finish.'),
              );
            else return;
            off();
          });
        });
      return send(recordingId);
    },
    async shutdown() {
      try {
        // A capture still running is finished first, so its file is on the list.
        if (active) await this.stop().catch(() => {});
        if (client) await client.shutdown();
      } finally {
        client = null;
        active = null;
      }
    },
    // Quitting with a recorder that has not answered its shutdown: end its process so it
    // cannot keep running without Bloom. The SDK has no public call for this, so this is the
    // one place that reaches past it. Recordings on disk are untouched.
    abandon() {
      try {
        client?.binaryManager?.kill?.();
      } catch {
        // nothing more can be done from here
      }
      client = null;
    },
  };
}

module.exports = { createLocalRecorder };
