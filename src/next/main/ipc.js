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

const copyLink = () =>
  clipboard.writeText('https://example.invalid/sample-recording'); // sample data: there is no real link yet

function registerIpc({ engine, prefs, theme, tray, windows, appState }) {
  ipcMain.handle('next:get-state', () => appState.withPrefs(engine.getState()));

  ipcMain.on('next:command', (event, name, args) => {
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
      windows.ownOnboardingSession(engine.getState().sessionId);
  });

  ipcMain.on('next:ui', (event, name, args = {}) => {
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
    if (name === 'copy-link') copyLink();
    if (name === 'open-settings')
      shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
    if (name === 'onboarding-done') {
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
      windows.closeOnboarding();
      windows.showPanel();
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
