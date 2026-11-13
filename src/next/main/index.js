// Entry point of the rebuilt Bloom app: lifecycle and wiring only.
// Until cutover it keeps its own user data so it never touches the current app's.
// Capture is supplied by src/next/engine.
const { app } = require('electron');
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

flags.separateUserData();
const theme = createTheme({ forced: flags.forcedTheme() });

// Everything else needs a ready app, so it is built in start() and kept here for quit and the test hook.
let engine, prefs, tray, windows, notifications, shortcuts;
let quitting = false;

function start() {
  engine = createEngine();
  prefs = createPrefs(flags.prefsFile());
  tray = createTray({ assets: flags.ASSETS });
  windows = createWindows({
    ui: flags.UI,
    preload: flags.PRELOAD,
    keepOpen: flags.flag('keep-open'),
    theme,
    engine,
    tray,
    isQuitting: () => quitting,
  });
  notifications = createNotifications({ engine, prefs, windows });
  shortcuts = createShortcuts({ engine, windows, notifications });
  const appState = createAppState({
    engine,
    prefs,
    theme,
    tray,
    notifications,
    windows,
  });

  appState.applyPrefs(); // before any window exists, so the first one opens in the right theme
  installMenu({ engine, windows });
  tray.onClick(windows.togglePanel);
  theme.onChange(windows.repaint);
  windows.createPanel();
  engine.onState(appState.broadcast);
  tray.paint(engine.getState());
  registerIpc({ engine, prefs, theme, tray, windows, appState });
  shortcuts.register();
}

function openFirstWindow() {
  if (flags.flag('skip-onboarding') || prefs.all().onboardingComplete)
    windows.showPanel();
  else {
    engine.command('setPermission', { key: 'screen', value: false });
    engine.command('setPermission', { key: 'mic', value: false });
    windows.openOnboarding();
  }
  if (flags.flag('open-preferences')) windows.openMain('settings');
  else if (flags.flag('open-main')) windows.openMain('library');
}

app.whenReady().then(() => {
  start();
  openFirstWindow();
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {}); // a tray app keeps running with no windows
app.on('will-quit', () => {
  shortcuts?.unregister();
  tray?.dispose();
  notifications?.dispose();
  engine?.dispose();
});

// Test hook: lets automation reach the tray panel, which has no window chrome to click.
global.__bloomNext = {
  showPanel: () => windows.showPanel(),
  openMain: (view) => windows.openMain(view),
  toggleCapture: () => shortcuts.toggleCapture(),
  getEngine: () => engine,
  getPrefs: () => prefs.all(),
};
