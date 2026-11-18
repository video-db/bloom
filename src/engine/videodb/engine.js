const { EventEmitter } = require('node:events');
const { initialState, pending } = require('./model');
const { safeError, ServiceError } = require('./errors');
const { createCapture } = require('./capture');
const { createJobs } = require('./jobs');
const { createAccess } = require('./access');
const { createLibraryCommands } = require('./library-commands');
const { createExploreCommands } = require('./explore-commands');
const { createUnderstandCommands } = require('./understand-commands');
const { createMakeCommands } = require('./make-commands');
const { createWindowSource } = require('./window-source');
const { validCommand } = require('./validate');

// One owner for app state. SDK, disk and UI code never share mutable state objects.
function createVideoDBEngine({
  service,
  recorder,
  cache,
  autoRestore = true,
  now,
  retryDelay, // how long before a recording the connection let down is tried again
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
  let autoTranscribe = true; // transcribe a new recording once it has been processed
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
        ...explore.cleared(),
        // Another account must not see the last one's chosen window or window titles.
        sources: { ...state.sources, window: '' },
        windows: { supported: false, list: [] },
        windowHidden: false,
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
    // A record is one of Bloom's own, or one in the collection being browsed.
    find: (id) =>
      state.recordings.find((r) => r.id === id) ||
      state.browsing?.recordings.find((r) => r.id === id),
    update(id, patch) {
      const apply = (r) => (r.id === id ? { ...r, ...patch } : r);
      if (state.recordings.some((r) => r.id === id))
        ctx.records(state.recordings.map(apply));
      else if (state.browsing)
        ctx.set({
          browsing: {
            ...state.browsing,
            recordings: state.browsing.recordings.map(apply),
          },
        });
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
  const jobs = createJobs(ctx, {
    service,
    recorder,
    ...(retryDelay ? { retryDelay } : {}),
    // A new recording is ready to play: transcribe and summarise it if the person wants that.
    onReady: (id) => {
      if (autoTranscribe) ctx.run(() => commands.requestTranscript({ id }));
    },
  });
  const explore = createExploreCommands(ctx, service);
  const understand = createUnderstandCommands(ctx, service);
  const windowSource = createWindowSource(ctx, recorder);
  const ownLibrary = createLibraryCommands(ctx, service, {
    beforeRename: understand.whenNamed,
  });
  // Refreshing the library also refreshes what the sidebar shows about the account.
  const library = {
    ...ownLibrary,
    async refresh() {
      await ownLibrary.refresh();
      await explore.overview();
    },
  };
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
    refresh: library.refresh,
    ...explore.commands,
    ...understand.commands,
    ...createMakeCommands(ctx, service).commands,
    ...windowSource.commands,
    // Opening a recording, or getting its transcript, also makes its summary when it can.
    async openRecording({ id }) {
      await ownLibrary.open(id);
      await understand.ensure(id);
    },
    async requestTranscript({ id }) {
      await ownLibrary.commands.requestTranscript({ id });
      await understand.ensure(id);
    },
    ...capture.commands,
    // A chosen window is checked again at the last moment; if it has gone, nothing starts.
    async start() {
      if (!(await windowSource.ready())) return;
      ctx.set({ windowHidden: false });
      await capture.commands.start();
    },
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
      ctx.set({
        sources: {
          ...state.sources,
          [key]: value,
          // Choosing a display means recording the display, not a window.
          ...(key === 'screen' ? { window: '' } : {}),
        },
      });
    },
    configure({ sources, autoTranscribe: auto }) {
      if (auto !== undefined) autoTranscribe = auto;
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
          },
        });
    },
    async newRecording() {
      if (state.phase === 'processing-error') {
        // The recorder is left running: it may be sending other recordings.
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
    // The camera is Bloom's own picture on screen, not a recorder source, so it can be
    // turned on or off at any time, recording or not.
    setCamera({ value }) {
      ctx.set({ sources: { ...state.sources, camera: value } });
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
          'This recording has not been processed yet.',
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
    // Last resort when quitting: the recorder did not stop in time and must not outlive Bloom.
    abandon() {
      recorder.abandon?.();
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
