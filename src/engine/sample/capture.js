// The capture state machine: one session from Start to a saved recording, with the
// pauses, problems and questions on the way. Nothing is recorded; timers stand in for
// capture, upload and processing.
const { script } = require('./data');

// `initial` builds the state of a session that has not started; `sources` owns what
// that session captures (see sources.js); `access` says whether a session may start.
function createCapture(ctx, { sources, access, initial }) {
  const { get, set, setQuietly, recordings, inBackground } = ctx;
  // Session timers: Pause, Stop and every reset cancel them, unlike ctx.inBackground.
  const timers = new Set();
  let tick = null;
  let serial = 0,
    sessionSerial = 0;
  // What the last Stop captured, kept so failed processing can be retried unchanged.
  let pendingFinish = null;

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
      const state = get();
      const elapsed = state.elapsed + 1;
      const patch = { elapsed };
      if (
        elapsed % 3 === 0 &&
        (state.sources.mic || state.sources.systemAudio)
      ) {
        const line = script[(elapsed / 3 - 1) % script.length];
        patch.live = [...state.live, line].slice(-2);
      }
      set(patch);
    }, 1000);
  }

  function finish(duration, trim = 0, snapshot = null) {
    pendingFinish = snapshot || {
      duration,
      trim,
      title: get().purpose,
      transcript: get().live.join(' ') || 'No sample speech was captured.',
      marks: structuredClone(get().marks),
    };
    const finishing = pendingFinish;
    clearAll();
    set({
      phase: 'saving',
      elapsed: duration,
      ask: null,
      problem: null,
      upload: { stage: 'finalizing', progress: 0 },
    });
    // A local recording is saved in three steps. Their timings add up to the 1.8 s
    // that saving takes here.
    const steps = 5;
    for (let step = 0; step <= steps; step++)
      later(400 + step * 200, () =>
        set({ upload: { stage: 'uploading', progress: step / steps } }),
      );
    later(1500, () => set({ upload: { stage: 'processing', progress: 1 } }));
    later(1800, () => {
      const title =
        finishing.title ||
        `Recording · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const id = `sample-${++serial}`;
      recordings.add({
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
      });
      set({
        phase: 'finished',
        upload: null,
        ...recordings.view(),
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
      // Processing outlives the session: starting another recording must not cancel it.
      inBackground(
        2500,
        () =>
          get().result?.id === id &&
          set({
            result: {
              ...get().result,
              stage: 1,
              summary: 'Sample summary: ' + finishing.transcript,
            },
          }),
      );
      inBackground(5500, () => {
        recordings.settle(id, (r) => ({ ...r, status: 'ready' }));
        set({
          ...recordings.view(),
          ...(get().result?.id === id
            ? { result: { ...get().result, stage: 2 } }
            : {}),
        });
      });
    });
  }

  function reset() {
    clearAll();
    sources.forgetChoices();
    pendingFinish = null;
    set(initial());
  }

  const commands = {
    start() {
      const state = get();
      if (state.phase !== 'idle' && state.phase !== 'finished') return;
      if (!access.signedIn()) return; // the panel offers sign-in instead of Start
      if (!access.online()) return set({ problem: { kind: 'offline' } });
      if (!sources.permissions().screen)
        return set({ problem: { kind: 'permission' } });
      clearAll();
      const fromFinished = state.phase === 'finished';
      if (fromFinished) sources.forgetChoices();
      pendingFinish = null;
      set({
        ...initial(),
        sources: fromFinished ? sources.fresh() : state.sources,
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
      if (get().phase === 'starting') {
        clearAll();
        set({ phase: 'idle' });
      }
    },
    stop() {
      if (['recording', 'paused'].includes(get().phase)) finish(get().elapsed);
    },
    pause() {
      if (get().phase === 'recording') {
        clearAll();
        set({ phase: 'paused' });
      }
    },
    resume() {
      if (get().phase === 'paused') {
        set({ phase: 'recording' });
        run();
      }
    },
    mark({ text } = {}) {
      if (get().phase !== 'recording') return;
      set({
        marks: [
          ...get().marks,
          { at: get().elapsed, text: (text || '').trim() },
        ],
      });
    },
    setPurpose({ text }) {
      setQuietly({ purpose: (text || '').trim() });
    },
    retry() {
      if (get().phase === 'stopped') {
        set({ phase: 'recording', problem: null });
        run();
      }
    },
    keep() {
      const { phase, problem, elapsed } = get();
      if (phase === 'stopped') finish(problem ? problem.at : elapsed);
    },
    answerAsk({ stop }) {
      const { ask, elapsed, trimEnding } = get();
      if (!ask) return;
      if (stop)
        return finish(
          elapsed,
          trimEnding === false ? 0 : Math.min(40, elapsed),
        );
      set({ ask: null, askSilenced: true });
    },
    trimEnding({ value }) {
      set({ trimEnding: !!value });
    },
    newRecording() {
      if (!['idle', 'finished', 'processing-error'].includes(get().phase))
        return;
      reset();
    },
    discard() {
      if (!['idle', 'finished', 'processing-error'].includes(get().phase))
        return;
      if (get().result) recordings.discard(get().result.id);
      reset();
    },
    retryProcessing() {
      if (get().phase === 'processing-error' && pendingFinish)
        finish(pendingFinish.duration, pendingFinish.trim, pendingFinish);
    },
  };

  // Preview-only: jump to states that are hard to reach by hand.
  function simulate(kind) {
    if (kind === 'processing-error' && get().phase === 'saving') {
      clearAll();
      set({ phase: 'processing-error', upload: null });
    }
    if (
      ['stop-failed', 'upload-slow'].includes(kind) &&
      get().phase === 'recording'
    )
      set({ problem: { kind } });
    if (kind === 'connection' && get().phase === 'recording') {
      clearAll();
      set({
        phase: 'stopped',
        problem: { kind: 'connection', at: get().elapsed },
      });
    }
    if (
      kind === 'meeting-ended' &&
      get().phase === 'recording' &&
      !get().askSilenced
    )
      set({ ask: 'meeting-ended', elapsed: Math.max(get().elapsed, 1930) });
    if (kind === 'permission' && get().phase === 'idle')
      set({
        permissions: sources.permit('screen', false),
        problem: { kind: 'permission' },
      });
  }

  return { commands, simulate, dispose: clearAll };
}

module.exports = { createCapture };
