// Recording a single window instead of a display: which windows there are, which one is
// chosen, and what happens when it has gone. A chosen window that is no longer there is
// never replaced by the whole display; the person is asked again.
const GONE = 'That window has closed. Choose what to record.';

function createWindowSource(ctx, recorder) {
  const between = () => ['idle', 'finished'].includes(ctx.get().phase);
  const chosen = () => ctx.get().sources.window;
  const recording = () => ['recording', 'paused'].includes(ctx.get().phase);

  // Read the open windows afresh. Their ids last only as long as the recorder process.
  async function refresh() {
    if (typeof recorder.windows !== 'function') return;
    const scope = ctx.scope();
    const found = await recorder.windows();
    if (scope !== ctx.scope()) return;
    // The window being recorded stays in the list even if it is off screen for a moment,
    // so its name stays on the panel.
    const current =
      !between() && ctx.get().windows.list.find((w) => w.id === chosen());
    const list =
      current && !found.windows.some((w) => w.id === current.id)
        ? [current, ...found.windows]
        : found.windows;
    ctx.set({ windows: { supported: found.supported, list } });
    if (chosen() && !found.windows.some((w) => w.id === chosen()) && between())
      ctx.set({
        sources: { ...ctx.get().sources, window: '' },
        problem: { kind: 'source', message: GONE },
      });
  }

  return {
    refresh,
    // True when Start may go ahead: no window is chosen, or the chosen one is still there.
    async ready() {
      if (!chosen()) return true;
      await refresh();
      return !!chosen();
    },
    commands: {
      // While recording a window: carry on with another one, without stopping.
      async switchWindow({ id }) {
        if (!recording() || !chosen() || id === chosen()) return;
        await refresh();
        if (!ctx.get().windows.list.some((w) => w.id === id)) {
          ctx.set({
            problem: {
              kind: 'source',
              message: 'That window is not open any more. Choose another.',
            },
          });
          return;
        }
        await recorder.switchWindow(id);
        ctx.set({
          sources: { ...ctx.get().sources, window: id },
          problem: null,
        });
      },
      // Hidden: the recording shows a plain card instead of the window until it is shown again.
      async setWindowHidden({ value }) {
        if (!recording() || !chosen()) return;
        await recorder.setWindowEnabled(!value);
        ctx.set({ windowHidden: value });
      },
      refreshWindows: refresh,
      // '' goes back to recording the display.
      chooseWindow({ id }) {
        if (!between()) return;
        if (id && !ctx.get().windows.list.some((w) => w.id === id)) return;
        ctx.set({
          sources: { ...ctx.get().sources, window: id },
          ...(ctx.get().problem?.kind === 'source' ? { problem: null } : {}),
        });
      },
    },
  };
}

module.exports = { createWindowSource };
