// Recording a single window instead of a display: which windows there are, which one is
// chosen, and what happens when it has gone. A chosen window that is no longer there is
// never replaced by the whole display; the person is asked again.
const GONE = 'That window has closed. Choose what to record.';

function createWindowSource(ctx, recorder) {
  const between = () => ['idle', 'finished'].includes(ctx.get().phase);
  const chosen = () => ctx.get().sources.window;

  // Read the open windows afresh. Their ids last only as long as the recorder process.
  async function refresh() {
    if (typeof recorder.windows !== 'function') return;
    const scope = ctx.scope();
    const found = await recorder.windows();
    if (scope !== ctx.scope()) return;
    ctx.set({ windows: { supported: found.supported, list: found.windows } });
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
