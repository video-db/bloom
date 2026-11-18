// The recorder, in the SDK's managed mode (ADR 0007): VideoDB authorises a recording before
// capture begins, and once it is stopped the recorder itself sends it to VideoDB and clears
// what it kept. Bloom only ever deals in recording ids; it never sees a file or a path.
// All SDK recorder calls and native event names are confined to this file (ADR 0005).
const { EventEmitter } = require('node:events');
const { ServiceError, request, safeError } = require('./errors');

// What managed capture accepts for sound: the system's default devices only.
const MIC = { id: 'mic:default', name: 'Microphone' };
const SYSTEM_AUDIO = { id: 'system_audio:default', name: 'System audio' };
const NATIVE_EVENTS = ['shutdown', 'error', 'window-closed', 'window-switched'];
// A long recording can take a long time to reach VideoDB, and the recorder retries a
// delivery for up to 24 hours; this wait only ends one the recorder has stopped reporting on.
const PROCESSING_WAIT_MS = 25 * 60 * 60 * 1000;
// The recorder may take a quarter of the recording's length plus 30 s to finish a long one,
// and at least 155 s; Stop waits for that and a margin.
const stopBudget = (seconds) =>
  Math.max(160000, Math.ceil((seconds / 4 + 30) * 1000) + 10000);
// The recorder's stages, as the engine knows them.
const STAGES = {
  ready: 'processing',
  uploaded: 'processing',
  processing: 'processing',
  complete: 'complete',
};
// Stages from recorders before the discard command was withdrawn: nothing to deliver.
const FORGOTTEN = ['discarding', 'discarded'];

function createLocalRecorder({
  CaptureClient,
  service,
  permissionStatus,
  permissionDecided = () => true,
  askMicrophone = null, // Bloom's own process asks for the microphone, when it can
}) {
  const events = new EventEmitter();
  const sessions = new Map(); // recordingId -> Bloom's session id, for this run
  const delivering = new Set(); // recordings the recorder is sending in this run
  const retrying = new Set(); // deliveries the recorder is waiting to try again
  let startedAt = 0; // when the current capture began, for Stop's budget
  let client = null;
  let active = null; // { recordingId, sessionId } while capturing
  let micAllowed = false; // the person said yes to Bloom's own microphone question

  // The recorder keeps each account's recordings apart by this key; it is not a credential.
  const owner = () => {
    const scopeId = service.cachedIdentity?.()?.scopeId;
    return scopeId ? `bloom-${scopeId.slice(0, 24)}` : null;
  };
  const tell = (name, recordingId, extra = {}) =>
    events.emit('event', name, {
      recordingId,
      sessionId: sessions.get(recordingId),
      ...extra,
    });
  const authorise = (collectionId) =>
    request(
      () => service.recorderAuthorization({ owner: owner(), collectionId }),
      { timeoutMs: 30000 },
    );

  function ensure() {
    if (client) return client;
    const instance = new CaptureClient({
      apiUrl: service.apiUrl,
      // A fresh token every time it is asked for: the recorder asks when the last one failed.
      getRecorderToken: async (job) =>
        job.owner === owner()
          ? (await authorise(job.collectionId)).token
          : null,
    });
    for (const name of NATIVE_EVENTS)
      instance.on(name, (payload) => {
        if (client === instance) events.emit('event', name, payload);
      });
    // How far delivery has got: sending and VideoDB's work as one share, below 1 until done.
    instance.on('processing-progress', (payload) => {
      if (client !== instance || payload?.owner !== owner()) return;
      if (!Number.isFinite(payload.percent)) return;
      // While the recorder waits to try again it reports no estimate; the recording keeps
      // waiting for a better connection until a measured one says delivery is moving.
      if (retrying.has(payload.recordingId)) {
        if (payload.etaSeconds === null) return;
        retrying.delete(payload.recordingId);
      }
      tell('recording-progress', payload.recordingId, {
        progress: Math.min(0.99, Math.max(0, payload.percent / 100)),
      });
    });
    instance.on('processing-complete', (payload) => {
      if (client !== instance || payload?.owner !== owner()) return;
      delivering.delete(payload.recordingId);
      retrying.delete(payload.recordingId);
      tell('processing-complete', payload.recordingId, {
        result: { videoId: payload.result?.videoId },
      });
    });
    for (const name of [
      'recording-failed',
      'processing-failed',
      'recording-token-error',
    ])
      instance.on(name, (payload) => {
        const id = payload?.recordingId;
        if (client !== instance || !(sessions.has(id) || delivering.has(id)))
          return;
        // Still retrying: the recorder carries on by itself, and its wait stays open.
        if (payload?.retrying === true) {
          retrying.add(id);
          tell('recording-relay-failed', id, { permanent: false, retrying: true });
          return;
        }
        delivering.delete(id);
        retrying.delete(id);
        // The recorder keeps the recording and can send it again unless it says it cannot.
        tell('recording-relay-failed', payload.recordingId, {
          permanent: payload?.retryable === false,
        });
      });
    client = instance;
    return client;
  }
  async function managed() {
    const { managedDeferredRecording } = await request(() =>
      ensure().getCapabilities(),
    );
    if (!managedDeferredRecording)
      throw new ServiceError(
        'recorder-outdated',
        'Recording needs a newer recorder. Update Bloom and try again.',
      );
  }
  async function list() {
    if (!owner()) return [];
    await managed();
    return request(() => ensure().listRecordings({ owner: owner() }));
  }
  // Ask the recorder to send a recording it already has. Resolves with the video when it
  // was already in VideoDB, or with nothing once the recorder has taken it on.
  async function deliver(recordingId) {
    const { token } = await authorise();
    delivering.add(recordingId);
    try {
      const answer = await request(
        () =>
          ensure().relayRecording({
            recordingId,
            owner: owner(),
            uploadToken: token,
          }),
        { mutation: true },
      );
      if (answer?.status === 'complete' && answer.result?.videoId) {
        delivering.delete(recordingId);
        return { recordingId, result: { videoId: answer.result.videoId } };
      }
      return null;
    } catch (error) {
      delivering.delete(recordingId);
      throw error;
    }
  }

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
    // Recordings of this account that VideoDB does not have yet, or that it has just been
    // given: found again after a restart. Listing never sends anything.
    async recover() {
      const jobs = await list();
      return jobs
        .filter(
          (job) =>
            !FORGOTTEN.includes(job.stage) &&
            job.recordingId !== active?.recordingId,
        )
        .map((job) => ({
          recordingId: job.recordingId,
          sessionId: sessions.get(job.recordingId),
          stage: STAGES[job.stage] || 'failed',
          ...(job.stage === 'complete' && job.result?.videoId
            ? { result: { videoId: job.result.videoId } }
            : {}),
          metadata: { duration_seconds: job.durationSeconds },
          // Not while the recorder waits to try again: that recording waits for a connection.
          ...(job.stage !== 'complete' &&
          !retrying.has(job.recordingId) &&
          Number.isFinite(job.progress?.percent)
            ? { progress: Math.min(0.99, job.progress.percent / 100) }
            : {}),
        }));
    },
    // Starts capture once VideoDB has authorised it. Throws `refused` when nothing is being
    // recorded, so Start can simply be pressed again.
    async start({ sessionId, channels, title }) {
      if (!owner())
        throw new ServiceError(
          'signed-out',
          'Connect your VideoDB account first.',
        );
      const refused = (message) =>
        Object.assign(new ServiceError('recorder-refused', message), {
          refused: true,
        });
      let authorization;
      try {
        await managed();
        authorization = await authorise();
      } catch (error) {
        throw refused(safeError(error).message);
      }
      let refusal = null; // the recorder answered, and the answer was no
      let started;
      try {
        started = await request(
          async () => {
            try {
              return await ensure().startRecording({
                owner: owner(),
                collectionId: authorization.collectionId,
                uploadToken: authorization.token,
                ...(title ? { name: title } : {}),
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
        throw refused(
          refusal.code === 'TARGET_NOT_FOUND'
            ? 'That window or display is no longer available. Choose what to record again.'
            : 'Recording could not start. Check that Bloom may record the screen in System Settings, then try again.',
        );
      }
      sessions.set(started.recordingId, sessionId);
      active = { recordingId: started.recordingId, sessionId };
      startedAt = Date.now();
      return { recordingId: started.recordingId };
    },
    // Ends capture. Once the recorder says the recording is ready it sends it by itself.
    // Resolves once capture has ended; throws only while capture may still be running, so
    // Stop can be tried again.
    async stop() {
      const recordingId = active?.recordingId;
      let result;
      let ended = false; // read from the SDK's own error, before it is made safe to show
      try {
        result = await request(
          async () => {
            try {
              return await ensure().stopRecording();
            } catch (error) {
              ended =
                error?.code === 'FINALIZE_FAILED' ||
                /no managed recording is active/i.test(String(error?.message));
              throw error;
            }
          },
          { timeoutMs: stopBudget((Date.now() - startedAt) / 1000), mutation: true },
        );
      } catch (error) {
        // The recorder says nothing is being recorded, and Bloom knew of nothing either.
        if (ended && !recordingId) return { nothing: true };
        if (!ended) throw error;
        // It could not be finished: the engine learns so when it waits for it.
        active = null;
        return;
      }
      const id = recordingId || result.recordingId;
      active = null;
      delivering.add(id);
      tell('local-recording-ready', id, {
        stage: 'processing',
        metadata: { duration_seconds: result.durationSeconds },
      });
    },
    pause: (tracks) =>
      request(() => ensure().pauseTracks(tracks), { mutation: true }),
    resume: (tracks) =>
      request(() => ensure().resumeTracks(tracks), { mutation: true }),
    // Recover: ask the recorder to send a recording again. Resolves once it has taken it on.
    async relay(recordingId) {
      const job = (await list()).find((j) => j.recordingId === recordingId);
      if (!job || FORGOTTEN.includes(job.stage))
        throw new ServiceError(
          'not-found',
          'This recording was made by an earlier version of Bloom and cannot be recovered here.',
        );
      if (job.stage === 'complete' && job.result?.videoId) {
        tell('processing-complete', recordingId, {
          result: { videoId: job.result.videoId },
        });
        return;
      }
      const done = await deliver(recordingId);
      if (done) tell('processing-complete', recordingId, done);
    },
    // Resolves when the recording is in VideoDB. One found after a restart is handed back
    // to the recorder first: listing it does not send it.
    async wait(target) {
      const recordingId =
        target.recordingId ||
        [...sessions].find(([, s]) => s === target.sessionId)?.[0];
      if (!recordingId)
        throw new ServiceError(
          'not-found',
          'This recording is not known here.',
        );
      const sessionId = sessions.get(recordingId) || target.sessionId;
      if (sessionId) sessions.set(recordingId, sessionId);
      const answer = (done) => ({
        recordingId,
        sessionId,
        result: { videoId: done.result?.videoId },
      });
      if (!delivering.has(recordingId) && active?.recordingId !== recordingId) {
        const job = (await list()).find((j) => j.recordingId === recordingId);
        if (!job || !STAGES[job.stage])
          throw new ServiceError('unavailable', 'Processing did not finish.');
        if (job.stage === 'complete') return answer(job);
        const done = await deliver(recordingId);
        if (done) return answer(done);
      }
      try {
        return answer(
          await ensure().waitForProcessing({
            recordingId,
            timeoutMs: PROCESSING_WAIT_MS,
          }),
        );
      } catch {
        delivering.delete(recordingId);
        throw new ServiceError('unavailable', 'Processing did not finish.');
      }
    },
    // Quitting or signing out never waits for a recording to reach VideoDB: the recorder
    // picks it up again on the next launch (ADR 0004).
    async shutdown() {
      try {
        if (active) await this.stop().catch(() => {});
        if (client) await client.shutdown({ waitForProcessing: false });
      } finally {
        client = null;
        active = null;
        delivering.clear();
      }
    },
    // Quitting with a recorder that has not answered its shutdown: end its process so it
    // cannot keep running without Bloom. The SDK has no public call for this, so this is the
    // one place that reaches past it. What the recorder keeps is untouched.
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

module.exports = { createLocalRecorder, stopBudget };
