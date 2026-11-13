const { ServiceError } = require('./errors');

function createAccess(ctx, { service, recorder, library, recover }) {
  let checking = false;
  async function connected(identity) {
    ctx.switchScope(identity.scopeId);
    ctx.set({
      account: { status: 'signed-in', label: 'VideoDB account' },
      online: true,
      problem: null,
    });
    await library.refresh();
    ctx.set({ permissions: recorder.permissions() });
    // Discovery initializes the recorder only after an explicit sign-in or saved-account restore.
    const channels = await recorder.channels();
    const sources = ctx.get().sources;
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
    });
    await recover();
  }
  async function bootstrap() {
    if (checking) return;
    checking = true;
    try {
      const cached = service.cachedIdentity?.();
      if (!cached) return;
      ctx.switchScope(cached.scopeId);
      ctx.set({ account: { status: 'checking', label: '' } });
      const identity = await service.restore();
      if (identity) await connected(identity);
    } catch (error) {
      ctx.set({
        account: {
          status: error.code === 'authentication' ? 'invalid' : 'offline',
          label: '',
        },
        online: false,
      });
      throw error;
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
        await connected(await service.signIn(key));
      } catch (error) {
        ctx.set({
          account: {
            status: error.code === 'authentication' ? 'invalid' : 'offline',
            label: '',
          },
        });
        throw error;
      } finally {
        checking = false;
      }
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
