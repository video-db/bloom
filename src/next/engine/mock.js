// Sample capture engine. It records nothing: it only walks through the states the
// real engine will report, so the interface can be built and judged first.
// The real engine must expose the same surface (see engine/index.js).
const { recordings: samples, moments } = require('./library');
const { EventEmitter } = require('node:events');

const SCRIPT = [
  'So I’m going to invite Priya to the workspace.',
  'I’m in Team settings, on Members.',
  'You can see we’ve got twelve of twelve seats used.',
  'I click Invite member, type her email,',
  'and when I press Send invite the dialog just closes.',
  'Nothing happened. No error, no email.',
  'Pending invites still says two.',
  'I think it’s because we’re out of seats, and it should say so.',
];

function createMockEngine() {
  const bus = new EventEmitter();
  const timers = new Set();
  let tick = null;
  let defaults = { mic: true, systemAudio: false, camera: false };
  let permissions = { screen: true, mic: true, camera: true };
  let recordings = structuredClone(samples);
  let serial = 0,
    sessionSerial = 0,
    versionSerial = 0;
  let pendingFinish = null;
  const sourceOverrides = new Set();
  let deleted = null;
  const libraryTimers = new Set();
  let state = initial();

  function initial() {
    return {
      sample: true,
      sessionId: null,
      phase: 'idle', // idle | starting | recording | paused | stopped | saving | finished
      elapsed: 0,
      sources: {
        screen: 'Display 1',
        ...defaults,
        mic: defaults.mic && permissions.mic,
        camera: defaults.camera && permissions.camera,
      },
      permissions,
      recordings,
      moments,
      trim: 0,
      purpose: '',
      live: [],
      marks: [],
      problem: null, // { kind: 'connection' | 'permission', at }
      ask: null, // 'meeting-ended'
      askSilenced: false,
      result: null, // { title, duration, stage: 0 link | 1 summary | 2 editor, summary }
      recent: recordings.slice(0, 3),
    };
  }

  const emit = () => bus.emit('state', state);
  const set = (patch) => {
    state = { ...state, ...patch };
    emit();
  };
  const later = (ms, fn) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const clearAll = () => {
    timers.forEach(clearTimeout);
    timers.clear();
    if (tick) clearInterval(tick);
    tick = null;
  };

  function run() {
    if (tick) clearInterval(tick);
    tick = setInterval(() => {
      const elapsed = state.elapsed + 1;
      const patch = { elapsed };
      if (
        elapsed % 3 === 0 &&
        (state.sources.mic || state.sources.systemAudio)
      ) {
        const line = SCRIPT[(elapsed / 3 - 1) % SCRIPT.length];
        patch.live = [...state.live, line].slice(-2);
      }
      set(patch);
    }, 1000);
  }

  const libraryLater = (ms, fn) => {
    const timer = setTimeout(() => {
      libraryTimers.delete(timer);
      fn();
    }, ms);
    libraryTimers.add(timer);
  };

  function updateRecord(id, update) {
    recordings = recordings.map((r) => (r.id === id ? update(r) : r));
    // Deleted records remain eligible for background job updates until Undo expires.
    if (deleted?.id === id) deleted = update(deleted);
  }

  function finish(duration, trim = 0, snapshot = null) {
    pendingFinish = snapshot || {
      duration,
      trim,
      title: state.purpose,
      transcript: state.live.join(' ') || 'No sample speech was captured.',
      marks: structuredClone(state.marks),
    };
    const finishing = pendingFinish;
    clearAll();
    set({ phase: 'saving', elapsed: duration, ask: null, problem: null });
    later(1800, () => {
      const title =
        finishing.title ||
        `Recording · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const id = `sample-${++serial}`;
      const recording = {
        id,
        title,
        duration,
        trim,
        status: 'processing',
        createdAt: Date.now(),
        meta: `Today · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`,
        transcript: finishing.transcript,
        marks: finishing.marks,
        silence: 0,
        filler: 0,
        chips: ['New recording'],
      };
      recordings = [recording, ...recordings];
      set({
        phase: 'finished',
        recordings,
        recent: recordings.slice(0, 3),
        result: {
          id,
          title,
          duration,
          trim,
          stage: 0,
          summary: '',
          renamed: false,
        },
      });
      libraryLater(
        2500,
        () =>
          state.result?.id === id &&
          set({
            result: {
              ...state.result,
              stage: 1,
              summary: 'Sample summary: ' + finishing.transcript,
            },
          }),
      );
      libraryLater(5500, () => {
        updateRecord(id, (r) => ({ ...r, status: 'ready' }));
        set({
          recordings,
          recent: recordings.slice(0, 3),
          ...(state.result?.id === id
            ? { result: { ...state.result, stage: 2 } }
            : {}),
        });
      });
    });
  }

  const commands = {
    start() {
      if (state.phase !== 'idle' && state.phase !== 'finished') return;
      if (!permissions.screen) return set({ problem: { kind: 'permission' } });
      clearAll();
      const fromFinished = state.phase === 'finished';
      const sources = fromFinished ? initial().sources : state.sources;
      if (fromFinished) sourceOverrides.clear();
      pendingFinish = null;
      set({
        ...initial(),
        sources,
        purpose: fromFinished ? '' : state.purpose,
        sessionId: `capture-${++sessionSerial}`,
        phase: 'starting',
      });
      later(1200, () => {
        set({ phase: 'recording' });
        run();
      });
    },
    cancel() {
      if (state.phase === 'starting') {
        clearAll();
        set({ phase: 'idle' });
      }
    },
    stop() {
      if (['recording', 'paused'].includes(state.phase)) finish(state.elapsed);
    },
    pause() {
      if (state.phase === 'recording') {
        clearAll();
        set({ phase: 'paused' });
      }
    },
    resume() {
      if (state.phase === 'paused') {
        set({ phase: 'recording' });
        run();
      }
    },
    mark({ text } = {}) {
      if (state.phase !== 'recording') return;
      set({
        marks: [
          ...state.marks,
          { at: state.elapsed, text: (text || '').trim() },
        ],
      });
    },
    setSource({ key, value }) {
      if (
        state.phase !== 'idle' ||
        (value && Object.hasOwn(permissions, key) && !permissions[key])
      )
        return;
      sourceOverrides.add(key);
      set({ sources: { ...state.sources, [key]: value } });
    },
    setPurpose({ text }) {
      state = { ...state, purpose: (text || '').trim() };
    },
    retry() {
      if (state.phase === 'stopped') {
        set({ phase: 'recording', problem: null });
        run();
      }
    },
    keep() {
      if (state.phase === 'stopped')
        finish(state.problem ? state.problem.at : state.elapsed);
    },
    answerAsk({ stop }) {
      if (!state.ask) return;
      if (stop)
        return finish(
          state.elapsed,
          state.trimEnding === false ? 0 : Math.min(40, state.elapsed),
        );
      set({ ask: null, askSilenced: true });
    },
    newRecording() {
      if (!['idle', 'finished', 'processing-error'].includes(state.phase))
        return;
      clearAll();
      sourceOverrides.clear();
      pendingFinish = null;
      set(initial());
    },
    discard() {
      if (!['idle', 'finished', 'processing-error'].includes(state.phase))
        return;
      if (state.result)
        recordings = recordings.filter((r) => r.id !== state.result.id);
      clearAll();
      sourceOverrides.clear();
      pendingFinish = null;
      set(initial());
    },
    checkPermission() {
      permissions = { ...permissions, screen: true };
      set({ permissions, problem: null });
    },
    setPermission({ key, value }) {
      if (!(key in permissions)) return;
      permissions = { ...permissions, [key]: !!value };
      set({
        permissions,
        sources: {
          ...state.sources,
          ...(key !== 'screen'
            ? {
                [key]:
                  !!value &&
                  (sourceOverrides.has(key)
                    ? state.sources[key]
                    : defaults[key]),
              }
            : {}),
        },
      });
    },
    configure({ sources }) {
      const changed = Object.keys(sources).filter(
        (k) => defaults[k] !== sources[k],
      );
      if (!changed.length) return;
      defaults = { ...defaults, ...sources };
      if (state.phase === 'idle') {
        const patch = Object.fromEntries(
          changed
            .filter((k) => !sourceOverrides.has(k))
            .map((k) => [k, defaults[k] && permissions[k] !== false]),
        );
        if (Object.keys(patch).length)
          set({ sources: { ...state.sources, ...patch } });
      }
    },
    trimEnding({ value }) {
      set({ trimEnding: !!value });
    },
    rename({ text }) {
      if (!state.result || !text.trim()) return;
      const title = text.trim();
      recordings = recordings.map((r) =>
        r.id === state.result.id ? { ...r, title } : r,
      );
      set({
        recordings,
        recent: recordings.slice(0, 3),
        result: { ...state.result, title, renamed: true },
      });
    },
    renameRecording({ id, text }) {
      if (typeof text !== 'string' || !text.trim()) return;
      const title = text.trim().slice(0, 180);
      recordings = recordings.map((r) => (r.id === id ? { ...r, title } : r));
      set({
        recordings,
        recent: recordings.slice(0, 3),
        ...(state.result?.id === id
          ? { result: { ...state.result, title } }
          : {}),
      });
    },
    deleteRecording({ id }) {
      deleted = recordings.find((r) => r.id === id);
      if (!deleted) return;
      recordings = recordings.filter((r) => r.id !== id);
      set({
        recordings,
        recent: recordings.slice(0, 3),
        ...(state.result?.id === id ? { result: null, phase: 'idle' } : {}),
      });
    },
    restoreRecording() {
      if (!deleted) return;
      recordings = [deleted, ...recordings];
      deleted = null;
      set({ recordings, recent: recordings.slice(0, 3) });
    },
    saveDraft({ id, draft }) {
      if (
        !draft ||
        typeof draft.text !== 'string' ||
        typeof draft.cuts !== 'object'
      )
        return;
      recordings = recordings.map((r) =>
        r.id === id
          ? {
              ...r,
              draft: {
                text: draft.text,
                cuts: {
                  sil: !!draft.cuts.sil,
                  fil: !!draft.cuts.fil,
                  cap: !!draft.cuts.cap,
                  chap: !!draft.cuts.chap,
                },
                trim: Number(draft.trim) || 0,
              },
              editedAt: Date.now(),
            }
          : r,
      );
      set({ recordings, recent: recordings.slice(0, 3) });
    },
    saveVersion({ id, version }) {
      if (!recordings.some((r) => r.id === id)) return;
      const createdAt = Date.now();
      const saved = {
        id: `version-${++versionSerial}`,
        name: version.name.trim(),
        value: structuredClone(version.value),
        kind: version.kind,
        ...(version.recipe ? { recipe: structuredClone(version.recipe) } : {}),
        ...(version.sources
          ? { sources: structuredClone(version.sources) }
          : {}),
        createdAt,
        time: new Date(createdAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      recordings = recordings.map((r) =>
        r.id === id ? { ...r, versions: [...(r.versions || []), saved] } : r,
      );
      set({ recordings, recent: recordings.slice(0, 3) });
    },
    renameVersion({ id, versionId, text }) {
      if (
        !recordings.some(
          (r) => r.id === id && r.versions?.some((v) => v.id === versionId),
        )
      )
        return;
      recordings = recordings.map((r) =>
        r.id === id
          ? {
              ...r,
              versions: r.versions.map((v) =>
                v.id === versionId ? { ...v, name: text.trim() } : v,
              ),
            }
          : r,
      );
      set({ recordings, recent: recordings.slice(0, 3) });
    },
    deleteVersion({ id, versionId }) {
      if (
        !recordings.some(
          (r) => r.id === id && r.versions?.some((v) => v.id === versionId),
        )
      )
        return;
      recordings = recordings.map((r) =>
        r.id === id
          ? { ...r, versions: r.versions.filter((v) => v.id !== versionId) }
          : r,
      );
      set({ recordings, recent: recordings.slice(0, 3) });
    },
    retryRecording({ id }) {
      if (!recordings.some((r) => r.id === id && r.status === 'error')) return;
      recordings = recordings.map((r) =>
        r.id === id ? { ...r, status: 'processing' } : r,
      );
      set({ recordings });
      const timer = setTimeout(() => {
        libraryTimers.delete(timer);
        updateRecord(id, (r) => ({ ...r, status: 'ready' }));
        set({ recordings, recent: recordings.slice(0, 3) });
      }, 1800);
      libraryTimers.add(timer);
    },
    retryProcessing() {
      if (state.phase === 'processing-error' && pendingFinish)
        finish(pendingFinish.duration, pendingFinish.trim, pendingFinish);
    },
    // Preview-only: jump to states that are hard to reach by hand.
    simulate({ kind }) {
      if (kind === 'processing-error' && state.phase === 'saving') {
        clearAll();
        set({ phase: 'processing-error' });
      }
      if (
        ['stop-failed', 'upload-slow'].includes(kind) &&
        state.phase === 'recording'
      )
        set({ problem: { kind } });
      if (kind === 'connection' && state.phase === 'recording') {
        clearAll();
        set({
          phase: 'stopped',
          problem: { kind: 'connection', at: state.elapsed },
        });
      }
      if (
        kind === 'meeting-ended' &&
        state.phase === 'recording' &&
        !state.askSilenced
      )
        set({ ask: 'meeting-ended', elapsed: Math.max(state.elapsed, 1930) });
      if (kind === 'permission' && state.phase === 'idle') {
        permissions = { ...permissions, screen: false };
        set({ permissions, problem: { kind: 'permission' } });
      }
    },
  };

  const object = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value) => typeof value === 'string';
  const id = (value) => text(value) && value.length > 0 && value.length <= 180;
  const booleanSources = ['mic', 'systemAudio', 'camera'];
  const draft = (value) =>
    object(value) &&
    text(value.text) &&
    object(value.cuts) &&
    ['sil', 'fil', 'cap', 'chap'].every(
      (k) => typeof value.cuts[k] === 'boolean',
    ) &&
    Number.isFinite(value.trim) &&
    value.trim >= 0;
  const recipe = (value) =>
    object(value) &&
    ['captions', 'dub', 'voice', 'music', 'vertical', 'short'].includes(
      value.type,
    ) &&
    text(value.option) &&
    value.option.length <= 100 &&
    text(value.prompt) &&
    value.prompt.length <= 500;
  const sources = (value) =>
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (item) =>
        object(item) &&
        id(item.recordingId) &&
        Number.isSafeInteger(item.at) &&
        item.at >= 0 &&
        text(item.text) &&
        item.text.length <= 500,
    );
  const valid = {
    setSource: (a) =>
      (a.key === 'screen' &&
        ['Display 1', 'Display 2 (sample)'].includes(a.value)) ||
      (booleanSources.includes(a.key) && typeof a.value === 'boolean'),
    setPurpose: (a) => text(a.text),
    mark: (a) => a.text === undefined || text(a.text),
    answerAsk: (a) => typeof a.stop === 'boolean',
    setPermission: (a) =>
      ['screen', 'mic', 'camera'].includes(a.key) &&
      typeof a.value === 'boolean',
    configure: (a) =>
      object(a.sources) &&
      Object.keys(a.sources).every(
        (k) => booleanSources.includes(k) && typeof a.sources[k] === 'boolean',
      ),
    trimEnding: (a) => typeof a.value === 'boolean',
    rename: (a) => text(a.text),
    renameRecording: (a) => id(a.id) && text(a.text),
    deleteRecording: (a) => id(a.id),
    retryRecording: (a) => id(a.id),
    saveDraft: (a) => id(a.id) && draft(a.draft),
    renameVersion: (a) =>
      id(a.id) &&
      id(a.versionId) &&
      text(a.text) &&
      a.text.trim().length > 0 &&
      a.text.length <= 100,
    deleteVersion: (a) => id(a.id) && id(a.versionId),
    saveVersion: (a) =>
      id(a.id) &&
      object(a.version) &&
      text(a.version.name) &&
      a.version.name.trim().length > 0 &&
      a.version.name.length <= 100 &&
      ['Edit snapshot', 'Search cut', 'Version recipe'].includes(
        a.version.kind,
      ) &&
      draft(a.version.value) &&
      (a.version.recipe === undefined
        ? a.version.kind !== 'Version recipe'
        : a.version.kind === 'Version recipe' && recipe(a.version.recipe)) &&
      (a.version.sources === undefined ||
        (a.version.kind === 'Search cut' && sources(a.version.sources))),
    simulate: (a) =>
      [
        'processing-error',
        'stop-failed',
        'upload-slow',
        'connection',
        'meeting-ended',
        'permission',
      ].includes(a.kind),
  };

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
        !object(args) ||
        (valid[name] && !valid[name](args))
      )
        return false;
      commands[name](args);
      return true;
    },
    dispose() {
      clearAll();
      libraryTimers.forEach(clearTimeout);
    },
  };
}

module.exports = { createMockEngine };
