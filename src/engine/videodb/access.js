const { ServiceError } = require('./errors');
const { canSignOut } = require('./model');
const { createSourceDiscovery } = require('./source-discovery');

// Who is signed in, what macOS allows, and whether the recorder is ready. These are three
// separate answers: a key that VideoDB accepted stays accepted even if the recorder or the
// library then fails, so neither failure is ever reported as a bad key.
function createAccess(
  ctx,
  {
    service,
    recorder,
    library,
    recover,
    leave = () => {},
    stay = () => {},
    browserSignIn = null,
  },
) {
  let checking = false;
  const discovery = createSourceDiscovery(ctx, recorder);

  // Starts the recorder and finds what it can capture. Runs only after sign-in.
  async function prepareRecorder() {
    return discovery.refresh({ preparing: true });
  }

  async function checkPermission() {
    const previous = ctx.get().permissions;
    if (ctx.get().account.status === 'signed-in') await recorder.refreshNativePermissions?.();
    const permissions = recorder.permissions();
    ctx.set({ permissions });
    if (
      permissions.screen &&
      (!previous.screen ||
        !ctx.get().channels.displays.length ||
        (permissions.mic && !previous.mic))
    ) {
      await discovery.refresh({ preparing: true, fresh: true });
    }
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
    // Recovery is background work; signing in and launching do not wait for it (ADR 0004).
    if (ready) ctx.run(recover);
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
  // The same rule as signing out: a recording that needs recovery does not block it.
  async function signInWith(work) {
    if (checking || !canSignOut(ctx.get()))
      throw new ServiceError(
        'busy',
        'Changing accounts is available once the recording has been processed.',
      );
    checking = true;
    ctx.set({ account: { status: 'checking', label: '' }, problem: null });
    try {
      let identity;
      try {
        identity = await work();
      } catch (error) {
        // A browser sign-in that did not finish leaves the account signed out; only a lost
        // connection reads as offline.
        if (error.browser && error.code !== 'network')
          ctx.set({ account: { status: 'signed-out', label: '' } });
        else rejected(error);
        throw error;
      }
      await connected(identity);
    } finally {
      checking = false;
    }
  }
  const commands = {
    refreshSources: () => discovery.refresh(),
    async signIn({ key }) {
      return signInWith(() => service.signIn(key));
    },
    // Sign in with VideoDB: the console's page opens in the browser and Bloom waits for it.
    async signInWithBrowser() {
      if (!browserSignIn?.available())
        throw new ServiceError(
          'unavailable',
          'Sign in with VideoDB isn’t available in this build. Use an API key instead.',
        );
      // Clicked again while waiting: the same page opens again.
      if (browserSignIn.pending()) return browserSignIn.start();
      return signInWith(async () =>
        service.signInWithToken(await browserSignIn.start()),
      );
    },
    cancelSignIn() {
      browserSignIn?.cancel();
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
      if (checking || !canSignOut(ctx.get()))
        throw new ServiceError(
          'busy',
          'Sign out is available once the recording has been processed.',
        );
      // The recorder's waits end with it; nothing has failed.
      leave();
      try {
        await recorder.shutdown();
      } finally {
        stay();
      }
      service.signOut();
      ctx.switchScope(null);
      ctx.set({
        account: { status: 'signed-out', label: '' },
        sources: { ...ctx.get().sources, camera: false },
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
      ctx.set({ permissions: recorder.permissions() });
      await discovery.refresh();
      await recover();
    },
    checkPermission,
    async setPermission({ key, value }) {
      if (value) await recorder.requestPermission(key);
      await checkPermission();
    },
  };
  return { commands, bootstrap };
}

module.exports = { createAccess };
