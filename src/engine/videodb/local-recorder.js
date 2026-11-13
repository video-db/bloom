// The recorder, in the SDK's standalone mode: a recording is a file on this Mac, made with
// no backend session or token. This adapter records, then sends the finished file to
// VideoDB itself, and keeps its own list of files so an unfinished one is found again after
// a restart. File paths stay in this module; the engine and the windows only ever see ids.
// All SDK recorder calls and native event names are confined to this file (ADR 0005).
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { ServiceError, request } = require('./errors');
const { atomicWrite } = require('./files');

// What standalone capture accepts for sound: the system's default devices only.
const MIC = { id: 'mic:default', name: 'Microphone' };
const SYSTEM_AUDIO = { id: 'system_audio:default', name: 'System audio' };
const NATIVE_EVENTS = ['shutdown', 'error', 'window-closed', 'window-switched'];

function createLocalRecorder({
  CaptureClient,
  service,
  journalFile,
  permissionStatus,
  permissionDecided = () => true,
}) {
  const events = new EventEmitter();
  const sending = new Map(); // recordingId -> promise of the completion payload
  let client = null;
  let active = null; // { recordingId, sessionId } while capturing

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
    const entry = entries[recordingId];
    if (!entry?.path) {
      if (entry) {
        update(recordingId, { stage: 'failed' });
        events.emit('event', 'recording-relay-failed', identity(recordingId));
      }
      return Promise.reject(
        new ServiceError(
          'not-found',
          'This recording’s file is not on this Mac, so it cannot be recovered.',
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
        mic: permissionStatus('microphone'),
        // macOS has an answer for the microphone: allowed or refused, not still asking.
        micDecided: permissionDecided('microphone'),
        camera: false,
      };
    },
    async requestPermission(key) {
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
      const started = await request(
        () =>
          ensure().startLocalRecording({
            channels: channels.map(({ channelId, type }) => ({
              channelId,
              type,
            })),
          }),
        { timeoutMs: 315000, mutation: true },
      );
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
        if (!ended || !recordingId) throw error;
        // The engine learns of it when it waits for this recording, once Stop has returned.
        active = null;
        update(recordingId, { stage: 'failed' });
        return;
      }
      const id = recordingId || result.recordingId;
      active = null;
      update(id, { path: result.path, stage: 'ready' });
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
