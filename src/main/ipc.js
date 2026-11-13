// Handlers for every message a renderer sends: the state request, engine commands and window-level actions.
// Messages are accepted only from our own live windows, and their arguments are checked before use.
const {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  shell,
  dialog,
} = require('electron');
const { createDownloads } = require('./downloads');
const { mediaUrl } = require('../engine/videodb/library');

const copyLink = () =>
  clipboard.writeText('https://example.invalid/sample-recording'); // sample data: there is no real link yet

function registerIpc({
  engine,
  prefs,
  theme,
  tray,
  windows,
  appState,
  screenPreview,
}) {
  const download = createDownloads({ engine, dialog });
  const fromOnboarding = (event) =>
    windows.roleOf(BrowserWindow.fromWebContents(event.sender)) ===
    'onboarding';
  // Paste in onboarding: the web clipboard API can wait forever on a permission question
  // nobody sees, so the main process answers, and only that window.
  ipcMain.handle('bloom:clipboard-text', (event) =>
    fromOnboarding(event) ? clipboard.readText().slice(0, 4096) : '',
  );
  ipcMain.handle('bloom:screen-preview', (event) =>
    fromOnboarding(event) ? screenPreview.capture() : null,
  );
  ipcMain.handle('bloom:get-state', (event) => {
    if (!windows.roleOf(BrowserWindow.fromWebContents(event.sender)))
      return null;
    return appState.withPrefs(engine.getState());
  });

  ipcMain.on('bloom:command', (event, name, args) => {
    const from = BrowserWindow.fromWebContents(event.sender);
    const role = windows.roleOf(from);
    if (!role) return;
    const previousSession = engine.getState().sessionId;
    engine.command(name, args);
    if (
      role === 'onboarding' &&
      name === 'start' &&
      engine.getState().sessionId !== previousSession
    )
      windows.ownOnboardingSession(
        engine.getState().operationId || engine.getState().sessionId,
      );
  });

  ipcMain.on('bloom:ui', (event, name, args = {}) => {
    const from = BrowserWindow.fromWebContents(event.sender);
    const role = windows.roleOf(from);
    if (
      !role ||
      typeof name !== 'string' ||
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args)
    )
      return;
    if (name === 'main-ready' && role === 'main') {
      windows.mainRendererReady();
      return;
    }
    if (
      name === 'panel-height' &&
      role === 'panel' &&
      Number.isFinite(args.height)
    )
      windows.resizePanel(args.height);
    if (name === 'reduced-motion' && typeof args.value === 'boolean') {
      tray.setReducedMotion(!!args.value);
      tray.paint(engine.getState());
    }
    if (name === 'preview-help') app.showAboutPanel();
    if (name === 'open-preferences') {
      windows.hidePanel();
      windows.openMain('settings');
    }
    if (name === 'close-panel') windows.hidePanel();
    if (name === 'set-pref' && typeof args.key === 'string') {
      const ok = prefs.set(String(args.key), args.value);
      appState.setPrefError(
        ok
          ? ''
          : 'Could not save this preference. Check available disk space and try again.',
      );
      if (ok) {
        if (
          args.key === 'openAtLogin' &&
          app.isPackaged &&
          !engine.getState().sample
        )
          app.setLoginItemSettings({ openAtLogin: !!args.value });
        if (args.key === 'appearance') theme.releaseForced();
        appState.applyPrefs();
      }
      appState.broadcast(engine.getState());
    }
    if (
      name === 'open-main' &&
      (args.view === undefined || typeof args.view === 'string') &&
      (args.id === undefined || typeof args.id === 'string')
    ) {
      windows.hidePanel();
      windows.openMain(
        args.id ? `${args.view || 'detail'}/${args.id}` : args.view,
      );
    }
    if (name === 'copy-link') {
      if (engine.getState().sample) copyLink();
      else {
        const state = engine.getState();
        const record = state.recordings.find(
          (r) => r.id === (args.id || state.result?.id),
        );
        const url = mediaUrl(record?.playerUrl);
        if (url && record.status === 'ready') {
          clipboard.writeText(url);
          engine.notice?.(
            'Link copied. Access follows your VideoDB collection settings.',
          );
        } else engine.notice?.('The playback link is not ready yet.');
      }
    }
    if (name === 'copy-transcript' && typeof args.id === 'string') {
      const record = engine.getState().recordings.find((r) => r.id === args.id);
      if (record?.transcript) {
        clipboard.writeText(record.transcript);
        engine.notice?.('Transcript copied.');
      }
    }
    if (
      name === 'download' &&
      !engine.getState().sample &&
      typeof args.id === 'string'
    )
      void download(from, args.id);
    if (name === 'get-api-key' && ['onboarding', 'main'].includes(role)) {
      // The renderer selects an action, never an arbitrary external destination.
      shell.openExternal('https://console.videodb.io/').catch(() => {
        appState.setPrefError(
          'Could not open your browser. Visit console.videodb.io to get an API key.',
        );
      });
    }
    if (name === 'open-settings')
      shell.openExternal(
        args.key === 'mic'
          ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
          : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
    if (name === 'onboarding-done') {
      if (
        !engine.getState().sample &&
        (engine.getState().account.status !== 'signed-in' ||
          !engine.getState().permissions.screen ||
          (engine.getState().sources.mic && !engine.getState().permissions.mic))
      )
        return;
      if (!prefs.set('onboardingComplete', true)) {
        const detail =
          'Could not save setup completion. Check available disk space and try again.';
        appState.setPrefError(detail);
        appState.broadcast(engine.getState());
        dialog
          .showMessageBox(from, {
            type: 'error',
            message: 'Setup could not be saved',
            detail,
          })
          .catch(() => {});
        return;
      }
      appState.setPrefError('');
      if (app.isPackaged && !engine.getState().sample)
        app.setLoginItemSettings({ openAtLogin: prefs.all().openAtLogin });
      appState.setHint('first-recording');
      appState.broadcast(engine.getState());
      windows.closeOnboarding();
      windows.showPanel();
    }
    // macOS can hold a new screen-recording permission until the app reopens. Setup resumes
    // on the same step, because the account is saved and the step follows from state.
    if (name === 'relaunch' && role === 'onboarding') {
      app.relaunch();
      app.quit();
    }
    if (name === 'show-panel') windows.showPanel();
    if (name === 'open-onboarding') {
      windows.hidePanel();
      windows.openOnboarding();
    }
    if (name === 'quit') app.quit();
  });
}

module.exports = { registerIpc };
