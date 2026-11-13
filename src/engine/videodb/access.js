const { ServiceError, safeError } = require('./errors');

// Who is signed in, what macOS allows, and whether the recorder is ready. These are three
// separate answers: a key that VideoDB accepted stays accepted even if the recorder or the
// library then fails, so neither failure is ever reported as a bad key.
function createAccess(ctx, { service, recorder, library, recover }) {
  let checking = false;

  // Starts the recorder and finds what it can capture. Runs only after sign-in.
  async function prepareRecorder() {
    ctx.set({ recorder: { status: 'preparing', message: '' } });
    let channels;
    try {
      channels = await recorder.channels();
    } catch (error) {
      ctx.set({
        recorder: { status: 'failed', message: safeError(error).message },
      });
      return false;
    }
    const sources = ctx.get().sources;
    ctx.set({
      recorder: { status: 'ready', message: '' },
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
    });
    return true;
  }

  async function connected(identity) {
    ctx.switchScope(identity.scopeId);
    ctx.set({
      account: { status: 'signed-in', label: 'VideoDB account' },
      online: true,
      problem: null,
      permissions: recorder.permissions(),
    });
    const ready = await prepareRecorder();
    await library.refresh();
    if (ready) await recover();
  }

  const rejected = (error) =>
    ctx.set({
      account: {
        status: error.code === 'authentication' ? 'invalid' : 'offline',
        label: '',
      },
    });
  async function bootstrap() {
    if (checking) return;
    checking = true;
    try {
      const cached = service.cachedIdentity?.();
      if (!cached) return;
      ctx.switchScope(cached.scopeId);
      ctx.set({ account: { status: 'checking', label: '' } });
      let identity;
      try {
        identity = await service.restore();
      } catch (error) {
        rejected(error);
        ctx.set({ online: false });
        throw error;
      }
      if (identity) await connected(identity);
    } finally {
      checking = false;
    }
  }
  const commands = {
    async signIn({ key }) {
      if (
        checking ||
        !['idle', 'finished'].includes(ctx.get().phase) ||
        ctx.get().pending.length
      )
        throw new ServiceError(
          'busy',
          'Finish pending recording work before changing accounts.',
        );
      checking = true;
      ctx.set({ account: { status: 'checking', label: '' }, problem: null });
      try {
        let identity;
        try {
          identity = await service.signIn(key);
        } catch (error) {
          rejected(error);
          throw error;
        }
        await connected(identity);
      } finally {
        checking = false;
      }
    },
    // Retry after the recorder failed to start. The account is untouched.
    async prepareRecorder() {
      if (
        ctx.get().account.status !== 'signed-in' ||
        ctx.get().recorder.status === 'preparing'
      )
        return;
      if (await prepareRecorder()) await recover();
    },
    async signOut() {
      if (
        checking ||
        !['idle', 'finished'].includes(ctx.get().phase) ||
        ctx.get().pending.length
      )
        throw new ServiceError(
          'busy',
          'Finish pending recording work before signing out.',
        );
      await recorder.shutdown();
      service.signOut();
      ctx.switchScope(null);
      ctx.set({
        account: { status: 'signed-out', label: '' },
        recorder: { status: 'idle', message: '' },
        phase: 'idle',
        result: null,
        sessionId: null,
        problem: null,
      });
    },
    async checkConnection() {
      if (ctx.get().account.status !== 'signed-in') return bootstrap();
      const pending = service.pendingOperations();
      if (pending.some((op) => op.kind === 'collection'))
        await service.reconcileCollection();
      if (pending.some((op) => op.kind === 'session'))
        await service.reconcileSession();
      await library.refresh();
      ctx.set({
        channels: await recorder.channels(),
        permissions: recorder.permissions(),
      });
      await recover();
    },
    async checkPermission() {
      ctx.set({ permissions: recorder.permissions() });
    },
    async setPermission({ key, value }) {
      if (value) await recorder.requestPermission(key);
      ctx.set({ permissions: recorder.permissions() });
    },
  };
  return { commands, bootstrap };
}

module.exports = { createAccess };
