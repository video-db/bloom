// Entry point of Bloom: lifecycle and wiring only. Capture is supplied by src/engine.
const {
  app,
  desktopCapturer,
  dialog,
  systemPreferences,
} = require('electron');
const { createEngine } = require('../engine');
const flags = require('./flags');
const { createPrefs } = require('./prefs');
const { createTheme } = require('./theme');
const { createTray } = require('./tray');
const { createWindows } = require('./windows');
const { createNotifications } = require('./notifications');
const { createAppState } = require('./state');
const { createShortcuts } = require('./shortcuts');
const { installMenu } = require('./menu');
const { registerIpc } = require('./ipc');
const { createQuitGuard, recordingQuitPrompt } = require('./quit-guard');
const { createScreenPreview } = require('./screen-preview');
const { openFirstWindow } = require('./first-window');

flags.separateUserData();
// Automated runs stay out of the Dock and never become the active app, so opening their
// windows cannot pull the person to another desktop.
if (flags.automated()) app.setActivationPolicy?.('accessory');
const primaryInstance =
  !app.requestSingleInstanceLock || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const theme = createTheme({ forced: flags.forcedTheme() });

// Everything else needs a ready app, so it is built in start() and kept here for quit and the test hook.
let engine, prefs, tray, windows, notifications, shortcuts, quitGuard, fixture;
let quitting = false,
  shutdownPending = false;

function start() {
  prefs = createPrefs(flags.prefsFile());
  // Walkthroughs drive the real engine against a fake service and recorder; never when packaged.
  if (flags.flag('fixture') && !app.isPackaged)
    fixture = require('../tests/helpers/fixture').createFixture();
  engine = fixture?.engine || createEngine({
    mode: 'videodb',
    dataDir: app.getPath('userData'),
    apiUrl:
      flags.flag('production') || app.isPackaged
        ? 'https://api.videodb.io'
        : 'https://api.dev.videodb.io',
    permissionStatus: (kind) =>
      systemPreferences.getMediaAccessStatus(kind) === 'granted',
    scope: flags.flag('v1') ? 'v1' : 'full',
    // Someone who has been through onboarding already has an account.
    signedIn: flags.flag('skip-onboarding') || prefs.all().onboardingComplete,
  });
  // Test runs and the sample engine must never look at the real screen or microphone.
  const real = !fixture && !engine.getState().sample;
  const screenPreview = createScreenPreview({
    capturer: desktopCapturer,
    allowed: () =>
      real && systemPreferences.getMediaAccessStatus('screen') === 'granted',
  });
  quitGuard = createQuitGuard({
    engine,
    ask: (options) => dialog.showMessageBoxSync(options),
  });
  tray = createTray({ assets: flags.ASSETS });
  windows = createWindows({
    ui: flags.UI,
    preload: flags.PRELOAD,
    keepOpen: flags.flag('keep-open'),
    background: flags.automated(),
    theme,
    engine,
    prefs,
    tray,
    isQuitting: () => quitting,
  });
  notifications = createNotifications({ engine, prefs, windows });
  shortcuts = createShortcuts({ engine, windows, notifications, prefs });
  const syncMenu = installMenu({ engine, windows, prefs });
  const appState = createAppState({
    syncMenu,
    engine,
    prefs,
    theme,
    tray,
    notifications,
    windows,
    loginSupported: !!app.isPackaged,
    version: app.getVersion?.() || '',
    livePreviews: real,
  });

  appState.applyPrefs(); // before any window exists, so the first one opens in the right theme
  tray.onClick(windows.togglePanel);
  theme.onChange(windows.repaint);
  windows.createPanel();
  engine.onState(appState.broadcast);
  appState.broadcast(engine.getState());
  registerIpc({
    engine,
    prefs,
    theme,
    tray,
    windows,
    appState,
    screenPreview,
  });
  shortcuts.register();
}

app
  .whenReady()
  .then(() => {
    if (!primaryInstance) return;
    start();
    return openFirstWindow({ engine, prefs, windows, flag: flags.flag });
  })
  .catch(() => {
    dialog.showErrorBox(
      'Bloom could not open',
      'Local state could not be opened safely. Existing files have been retained. Check available disk space and restart Bloom; do not delete pending recording data.',
    );
    quitting = true;
    app.quit();
  });

app.on('before-quit', (event) => {
  if (engine && !engine.getState().sample && !quitting) {
    event.preventDefault();
    if (shutdownPending) return;
    const state = engine.getState();
    const prompt = recordingQuitPrompt(state);
    const suspend = !!prompt && dialog.showMessageBoxSync(prompt) === 1;
    if (prompt && !suspend) return;
    shutdownPending = true;
    engine
      .shutdown({ suspend })
      .then(() => {
        quitting = true;
        app.quit();
      })
      .catch(() => {
        shutdownPending = false;
        dialog.showMessageBox({
          type: 'error',
          message: 'Bloom could not finish stopping safely',
          detail:
            'Keep Bloom open and check the recording status. Try Stop again before quitting.',
        });
      });
    return;
  }
  if (quitGuard && !quitGuard.allows()) return event.preventDefault();
  quitting = true;
});
// macOS reopens a running app through activation rather than a second process.
app.on('activate', () => windows?.showPanel());
app.on('second-instance', () => windows?.showPanel());
app.on('window-all-closed', () => {}); // a tray app keeps running with no windows
app.on('will-quit', () => {
  shortcuts?.unregister();
  tray?.dispose();
  notifications?.dispose();
  engine?.dispose();
});

// Test hook: lets automation reach the tray panel, which has no window chrome to click.
global.__bloom = {
  showPanel: () => windows.showPanel(),
  openMain: (view) => windows.openMain(view),
  toggleCapture: () => shortcuts.toggleCapture(),
  getEngine: () => engine,
  getPrefs: () => prefs.all(),
  hasTray: () => tray.isAvailable(),
  getFixture: () => (!app.isPackaged ? fixture : undefined),
};
