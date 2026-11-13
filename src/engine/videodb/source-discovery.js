const { safeError } = require('./errors');

// Device discovery may outlive a tray opening, account switch or recording start.
// Only update choices while the same account is still between recordings.
function createSourceDiscovery(ctx, recorder) {
  let pending = null;
  const available = () =>
    ctx.get().account.status === 'signed-in' &&
    ['idle', 'finished'].includes(ctx.get().phase);

  function refresh({ preparing = false, fresh = false } = {}) {
    if (!available()) return Promise.resolve(false);
    const scope = ctx.scope();
    if (pending?.scope === scope) {
      return fresh
        ? pending.promise.then(() => refresh({ preparing }))
        : pending.promise;
    }
    const current = () => available() && ctx.scope() === scope;
    if (preparing) ctx.set({ recorder: { status: 'preparing', message: '' } });
    const promise = Promise.resolve()
      .then(async () => {
        try {
          const channels = await recorder.channels();
          if (!current()) return false;
          const sources = ctx.get().sources;
          const missing =
            recorder.permissions().screen && !channels.displays.length;
          const message =
            'No displays are available. Quit and reopen Bloom after allowing screen recording.';
          ctx.set({
            channels,
            sources: {
              ...sources,
              screen: channels.displays.some((c) => c.id === sources.screen)
                ? sources.screen
                : channels.displays[0]?.id || '',
              microphone: channels.mics.some((c) => c.id === sources.microphone)
                ? sources.microphone
                : channels.mics[0]?.id || '',
            },
            recorder: missing
              ? {
                  status: 'failed',
                  message,
                }
              : { status: 'ready', message: '' },
            ...(missing
              ? { problem: { kind: 'source', message } }
              : ctx.get().problem?.kind === 'source'
                ? { problem: null }
                : {}),
          });
          return !missing;
        } catch (error) {
          if (current())
            ctx.set({
              recorder: { status: 'failed', message: safeError(error).message },
            });
          return false;
        }
      })
      .finally(() => {
        if (pending?.promise === promise) pending = null;
      });
    pending = { scope, promise };
    return promise;
  }
  return { refresh };
}

module.exports = { createSourceDiscovery };
