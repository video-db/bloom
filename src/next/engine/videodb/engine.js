const { EventEmitter } = require('node:events');
const { initialState, pending } = require('./model');
const { safeError, ServiceError } = require('./errors');
const { createCapture } = require('./capture');
const { createJobs } = require('./jobs');
const { createAccess } = require('./access');
const { createLibraryCommands } = require('./library-commands');
const { validCommand } = require('./validate');

// One owner for app state. SDK, disk and UI code never share mutable state objects.
function createVideoDBEngine({
  service,
  recorder,
  cache,
  autoRestore = true,
  now,
}) {
  const bus = new EventEmitter();
  const commandsInFlight = new Set();
  let state = initialState();
  state.environment = service.apiUrl.includes('.dev.')
    ? 'VideoDB development'
    : 'VideoDB production';
  let scopeId = null;
  let disposed = false;
  let defaults = { mic: true, systemAudio: false };
  const sourceOverrides = new Set();
  const ctx = {
    get: () => state,
    scope: () => scopeId,
    set(patch) {
      if (disposed) return;
      state = { ...state, ...patch };
      bus.emit('state', structuredClone(state));
    },
    switchScope(id) {
      scopeId = id;
      const records = id ? cache.load(id) : [];
      ctx.set({
        recordings: records,
        recent: records.slice(0, 3),
        pending: pending(records),
        marks: [],
        result: null,
        notice: cache.warning || '',
      });
    },
    records(records) {
      if (disposed || !scopeId) return;
      cache.save(scopeId, records);
      ctx.set({
        recordings: records,
        recent: records.slice(0, 3),
        pending: pending(records),
      });
    },
    find: (id) => state.recordings.find((r) => r.id === id),
    update(id, patch) {
      ctx.records(
        state.recordings.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
    },
    run(work) {
      try {
        return Promise.resolve(work()).catch((error) => {
          const safe = safeError(error);
          if (state.problem?.kind === 'capture-unknown') return false;
          ctx.set({
            problem: {
              kind: safe.code,
              message: safe.message,
              uncertain: safe.uncertain,
            },
          });
          return false;
        });
      } catch (error) {
        const safe = safeError(error);
        ctx.set({
          problem: {
            kind: safe.code,
            message: safe.message,
            uncertain: safe.uncertain,
          },
        });
        return Promise.resolve(false);
      }
    },
  };
  const jobs = createJobs(ctx, { service, recorder });
  const library = createLibraryCommands(ctx, service);
  const access = createAccess(ctx, {
    service,
    recorder,
    library,
    recover: jobs.recover,
  });
  const capture = createCapture(ctx, { service, recorder, jobs, now });
  const between = () => ['idle', 'finished'].includes(state.phase);
  const commands = {
    ...access.commands,
    ...library.commands,
    ...capture.commands,
    setPurpose({ text }) {
      if (between()) ctx.set({ purpose: text });
    },
    setSource({ key, value }) {
      if (!between()) return;
      if (
        key === 'screen' &&
        !state.channels.displays.some((c) => c.id === value)
      )
        return;
      if (
        key === 'microphone' &&
        !state.channels.mics.some((c) => c.id === value)
      )
        return;
      sourceOverrides.add(key);
      ctx.set({ sources: { ...state.sources, [key]: value } });
    },
    configure({ sources }) {
      defaults = { ...defaults, ...sources };
      if (between())
        ctx.set({
          sources: {
            ...state.sources,
            ...Object.fromEntries(
              ['mic', 'systemAudio']
                .filter((key) => !sourceOverrides.has(key))
                .map((key) => [key, defaults[key]]),
            ),
            camera: false,
          },
        });
    },
    async newRecording() {
      if (state.phase === 'processing-error') {
        await recorder.shutdown({ suspend: true });
        const record = state.recordings.find(
          (r) => r.sessionId === state.sessionId,
        );
        if (record && !record.videoId)
          ctx.update(record.id, {
            paused: true,
            status: 'error',
            jobStage: 'paused-upload',
          });
      }
      capture.commands.newRecording();
      if (state.phase === 'idle') {
        sourceOverrides.clear();
        ctx.set({
          sources: {
            ...state.sources,
            mic: defaults.mic,
            systemAudio: defaults.systemAudio,
          },
        });
      }
    },
    retryRecording: ({ id }) => jobs.retry(id),
    resumeUpload: ({ id }) => jobs.retry(id),
  };
  const unsubscribe = recorder.onEvent((name, payload) => {
    ctx.run(async () => {
      if (name === 'recording-complete')
        capture.observedStop(payload?.sessionId);
      if (
        ['error', 'shutdown'].includes(name) &&
        ['recording', 'paused', 'starting', 'stopping'].includes(state.phase)
      ) {
        capture.dispose();
        ctx.set({
          phase: 'stopped',
          problem: {
            kind: 'recorder-exited',
            message:
              'The recorder stopped unexpectedly. Recovery must be checked before starting again.',
          },
        });
      }
      await jobs.event(name, payload);
    });
  });
  const ready = autoRestore ? ctx.run(access.bootstrap) : Promise.resolve();
  return {
    ready,
    getState: () => structuredClone(state),
    notice(message) {
      ctx.set({ notice: message });
    },
    onState(listener) {
      bus.on('state', listener);
      return () => bus.off('state', listener);
    },
    command(name, args = {}) {
      if (disposed || !validCommand(name, args)) return false;
      const task = ctx.run(() => commands[name](args));
      commandsInFlight.add(task);
      task.finally(() => commandsInFlight.delete(task));
      return true;
    },
    async whenIdle() {
      await Promise.all([...commandsInFlight]);
    },
    async prepareDownload(id) {
      const record = ctx.find(id);
      if (!record?.videoId)
        throw new ServiceError(
          'not-found',
          'Select an uploaded recording first.',
        );
      return service.prepareDownload(record.videoId);
    },
    async shutdown({ suspend = false } = {}) {
      if (['starting', 'stopping'].includes(state.phase))
        throw new ServiceError(
          'busy',
          'Wait for the recording command to finish before quitting.',
        );
      if (['recording', 'paused', 'stopped'].includes(state.phase))
        await capture.commands.stop();
      if (state.phase === 'stopped')
        throw new ServiceError(
          'capture-unknown',
          'Capture stop could not be confirmed. Keep Bloom open and try Stop again.',
        );
      await recorder.shutdown({ suspend });
    },
    dispose() {
      disposed = true;
      unsubscribe();
      capture.dispose();
      jobs.dispose();
      bus.removeAllListeners();
    },
  };
}

module.exports = { createVideoDBEngine };
