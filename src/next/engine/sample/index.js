// Sample capture engine. It records nothing: it only walks through the states the
// real engine will report, so the interface can be built and judged first.
// This file owns the state object and composes the parts that change it. The real
// engine must expose the same surface (see ../index.js).
const { EventEmitter } = require('node:events');
const { recordings: samples, moments } = require('./data');
const { createRecordings } = require('./recordings');
const { createSources } = require('./sources');
const { createCapture } = require('./capture');
const { createLibrary } = require('./library');
const { createVersions } = require('./versions');
const { validArgs } = require('./validate');

function createSampleEngine() {
  const bus = new EventEmitter();
  const backgroundTimers = new Set();
  let state;

  // What every part is given: the only way to read or change state, the recordings
  // store, and a timer for work that must outlive a capture session.
  const ctx = {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      bus.emit('state', state);
    },
    // Changes state without telling listeners; they see it with the next emitted state.
    setQuietly(patch) {
      state = { ...state, ...patch };
    },
    recordings: createRecordings(samples),
    inBackground(ms, fn) {
      const timer = setTimeout(() => {
        backgroundTimers.delete(timer);
        fn();
      }, ms);
      backgroundTimers.add(timer);
    },
  };

  const sources = createSources(ctx);

  // The state before a session starts, over the current sources and recordings.
  const initial = () => ({
    sample: true,
    sessionId: null,
    phase: 'idle', // idle | starting | recording | paused | stopped | saving | finished | processing-error
    elapsed: 0,
    sources: sources.fresh(),
    permissions: sources.permissions(),
    recordings: ctx.recordings.all(),
    moments,
    trim: 0,
    purpose: '',
    live: [],
    marks: [],
    problem: null, // { kind: 'connection' | 'permission' | 'stop-failed' | 'upload-slow', at }
    ask: null, // 'meeting-ended'
    askSilenced: false,
    result: null, // { id, title, duration, trim, stage: 0 link | 1 summary | 2 editor, summary, renamed }
    recent: ctx.recordings.recent(),
  });

  const capture = createCapture(ctx, { sources, initial });
  const commands = {
    ...sources.commands,
    ...capture.commands,
    ...createLibrary(ctx).commands,
    ...createVersions(ctx).commands,
  };
  state = initial();

  return {
    getState: () => state,
    onState: (fn) => {
      bus.on('state', fn);
      return () => bus.off('state', fn);
    },
    command(name, args = {}) {
      if (
        typeof name !== 'string' ||
        !Object.hasOwn(commands, name) ||
        !validArgs(name, args)
      )
        return false;
      commands[name](args);
      return true;
    },
    dispose() {
      capture.dispose();
      backgroundTimers.forEach(clearTimeout);
    },
  };
}

module.exports = { createSampleEngine };
