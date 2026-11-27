// Entry point of Bloom: lifecycle and wiring only. Capture is supplied by src/engine.
const {
  app,
  screen,
  session,
  net,
  powerMonitor,
  BrowserWindow,
  desktopCapturer,
  dialog,
  systemPreferences,
  powerSaveBlocker,
  shell,
} = require('electron');
const { createEngine } = require('../engine');
const flags = require('./flags');
const { createPrefs } = require('./prefs');
const { afterUpdate } = require('./after-update');
const { createUpdater } = require('./updater');
const { createLinuxUpdater } = require('./linux-updater');
const { createKeepAwake } = require('./keep-awake');
const path = require('node:path');
const { createTheme } = require('./theme');
const { createTray } = require('./tray');
const { createWindows } = require('./windows');
const { createFloating } = require('./floating');
const { createNotifications } = require('./notifications');
const { createAppState } = require('./state');
const { createShortcuts } = require('./shortcuts');
const { installMenu } = require('./menu');
const { registerIpc } = require('./ipc');
const {
  createQuitGuard,
  recordingQuitPrompt,
  quitsQuietly,
  settledWithin,
} = require('./quit-guard');
const { createScreenPreview } = require('./screen-preview');
const { openFirstWindow } = require('./first-window');

if (process.platform === 'linux') {
  const features = app.commandLine.getSwitchValue('enable-features');
  app.commandLine.appendSwitch('enable-features', [features, 'GlobalShortcutsPortal'].filter(Boolean).join(','));
}
flags.separateUserData();
// Automated runs stay out of the Dock and never become the active app, so opening their
// windows cannot pull the person to another desktop.
if (flags.automated()) app.setActivationPolicy?.('accessory');
const primaryInstance =
  !app.requestSingleInstanceLock || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const theme = createTheme({ forced: flags.forcedTheme() });

// Everything else needs a ready app, so it is built in start() and kept here for quit and the test hook.
let engine,
  prefs,
  tray,
  windows,
  floating,
  notifications,
  shortcuts,
  quitGuard,
  fixture,
  updater;
let quitting = false,
  shutdownPending = false,
  reopen = false; // Bloom was asked to reopen once it has quit

// The internal Linux build authenticates recordings against the development service.
const linuxPreview = process.platform === 'linux' && require('../../package.json').bloomLinuxPreview === true;
if (linuxPreview) {
  process.env.VIDEODB_INTERNAL_DEV = '1';
}

function start() {
  prefs = createPrefs(flags.prefsFile());
  // After an update Screen Recording may need turning on again; setup will say so.
  const updated = afterUpdate({
    version: app.getVersion?.() || '',
    prefs,
    packaged: !!app.isPackaged,
    screenStatus: () => systemPreferences?.getMediaAccessStatus?.('screen'),
  });
  // Walkthroughs drive the real engine against a fake service and recorder; never when packaged.
  if (flags.flag('fixture') && !app.isPackaged)
    fixture = require('../tests/helpers/fixture').createFixture();
  engine =
    fixture?.engine ||
    createEngine({
      mode: 'videodb',
      dataDir: app.getPath('userData'),
      apiUrl:
        !linuxPreview && (flags.flag('production') || app.isPackaged)
          ? 'https://api.videodb.io'
          : 'https://api.dev.videodb.io',
      permissionStatus: (kind) =>
        systemPreferences.getMediaAccessStatus?.(kind) === 'granted',
      // False while macOS is still asking the person, so setup does not call that "off".
      permissionDecided: (kind) =>
        systemPreferences.getMediaAccessStatus?.(kind) !== 'not-determined',
      // The microphone question is asked by Bloom itself: the answer is the result, and
      // this process then reads the permission correctly. Asked by the recorder, a separate
      // process, the answer reached macOS but this process went on reading "not asked".
      askMicrophone: process.platform === 'darwin'
        ? () => systemPreferences.askForMediaAccess('microphone')
        : null,
      // Sign in with VideoDB opens the console's page in the person's browser.
      openExternal: (url) =>
        /^https:\/\//.test(url)
          ? shell.openExternal(url)
          : Promise.reject(new Error('not a web page')),
      scope: flags.flag('v1') ? 'v1' : 'full',
      // Someone who has been through onboarding already has an account.
      signedIn: flags.flag('skip-onboarding') || prefs.all().onboardingComplete,
    });
  // Test runs and the sample engine must never look at the real screen or microphone.
  const real = !fixture && !engine.getState().sample;
  const screenPreview = createScreenPreview({
    capturer: desktopCapturer,
    allowed: () =>
      real && systemPreferences.getMediaAccessStatus?.('screen') === 'granted',
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
  floating = createFloating({
    screen,
    surface: windows.surface,
    prefs,
    isQuitting: () => quitting,
    still: !real,
    // macOS asks the first time; after a refusal only System Settings can change it.
    allowCamera: async () =>
      !real ||
      process.platform !== 'darwin' ||
      systemPreferences.askForMediaAccess('camera'),
    cameraRefused() {
      engine.command('setCamera', { value: false });
      engine.notice?.(
        'Bloom cannot use the camera. Allow it in System Settings, under Privacy & Security, Camera.',
      );
    },
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
    floating,
    loginSupported: !!app.isPackaged,
    updated,
    version: app.getVersion?.() || '',
    livePreviews: real,
  });

  // Once Bloom is on its way out, nothing new starts: a recording begun in the moment
  // before it closes would be lost without a word.
  const command = engine.command.bind(engine);
  engine.command = (name, args) =>
    name === 'start' && (shutdownPending || quitting)
      ? false
      : command(name, args);

  // Each of Bloom's windows may ask for only what it needs. Electron otherwise grants
  // every permission to every page: the camera to the camera picture, the microphone to
  // setup's voice check, full screen to the player, and copying where there is a Copy.
  const MAY = {
    media: ['camera', 'onboarding'],
    fullscreen: ['main'],
    'clipboard-sanitized-write': ['main', 'panel', 'onboarding'],
  };
  const may = (contents, permission) => {
    const window = contents && BrowserWindow.fromWebContents(contents);
    const role = window && (windows.roleOf(window) || floating.roleOf(window));
    return !!role && (MAY[permission] || []).includes(role);
  };
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, answer) => answer(may(contents, permission)),
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    may(contents, permission),
  );
  // Displays come and go: the control must not be left on one that is now being recorded,
  // nor the camera on one that is no longer there.
  for (const change of [
    'display-added',
    'display-removed',
    'display-metrics-changed',
  ])
    screen.on(change, () => floating.displaysChanged(engine.getState()));

  appState.applyPrefs(); // before any window exists, so the first one opens in the right theme
  tray.onClick(windows.togglePanel);
  theme.onChange(windows.repaint);
  windows.createPanel();
  engine.onState(appState.broadcast);
  const keepAwake = createKeepAwake({ blocker: powerSaveBlocker });
  engine.onState((state) => keepAwake.observe(state));
  appState.broadcast(engine.getState());
  registerIpc({
    engine,
    prefs,
    theme,
    tray,
    windows,
    appState,
    floating,
    screenPreview,
    restart: restartForPermission,
    // Settings' Check for updates and Restart to update; nothing in a build that does not update.
    updates: {
      check: () => updater?.checkNow(),
      install: () => updater?.installNow(),
    },
  });
  shortcuts.register();
  // A newer Bloom is downloaded in the background and goes in only when Bloom is not in
  // use, or when the person next quits. Never from source or in automated runs.
  if (app.isPackaged && (process.platform === 'darwin' || linuxPreview) && !flags.automated()) {
    const makeUpdater = linuxPreview ? createLinuxUpdater : createUpdater;
    updater = makeUpdater({
      relaunch: () => app.relaunch(),
      version: app.getVersion(),
      appPath: path.resolve(app.getPath('exe'), '..', '..', '..'),
      updatesDir: path.join(app.getPath('userData'), 'updates'),
      getState: () => engine.getState(),
      windowsOpen: () => windows.anyVisible() || floating.cameraShowing(),
      systemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
      quit: () => app.quit(),
      fetchImpl: (url, options) => net.fetch(url, options),
      log: (message) => console.log(`[update] ${message}`),
    });
    appState.setUpdate(updater.shown());
    updater.onStatus((shown) => {
      appState.setUpdate(shown);
      appState.broadcast(engine.getState());
    });
    updater.start();
    appState.broadcast(engine.getState());
  }
}

app
  .whenReady()
  .then(async () => {
    if (!primaryInstance) return;
    start();
    if (await linuxShortcut(process.argv)) return;
    return openFirstWindow({ engine, prefs, windows, flag: flags.flag });
  })
  .catch((error) => {
    // To the log only: what went wrong is for whoever is looking into it.
    console.error('Bloom could not open:', error);
    dialog.showErrorBox(
      'Bloom could not open',
      'Local state could not be opened safely. Existing files have been retained. Check available disk space and restart Bloom; do not delete pending recording data.',
    );
    quitting = true;
    app.quit();
  });

// Quit with nothing being captured: the recorder gets a moment to stop, and is ended if it
// has not, so it never outlives Bloom. Recordings on this Mac are picked up on the next launch.
function quitQuietly() {
  shutdownPending = true;
  let stopped = false;
  settledWithin(
    engine.shutdown({ suspend: true }).then(() => {
      stopped = true;
    }),
  ).then(() => {
    if (!stopped) engine.abandon?.();
    quitting = true;
    app.quit();
  });
}

// Setup asks Bloom to reopen so macOS applies a newly granted permission.
function restartForPermission() {
  reopen = true; // acted on only if this quit goes through
  if (!engine || !quitsQuietly(engine.getState())) return app.quit();
  quitQuietly();
}

app.on('before-quit', (event) => {
  if (engine && !engine.getState().sample && !quitting) {
    event.preventDefault();
    if (shutdownPending) return;
    // Only capture, or a file still being written, is worth a question (ADR 0004).
    const prompt = recordingQuitPrompt(engine.getState());
    if (!prompt) return quitQuietly();
    if (dialog.showMessageBoxSync(prompt) !== 1) {
      reopen = false; // staying open: a restart that was asked for is off
      return;
    }
    shutdownPending = true;
    engine
      .shutdown({ suspend: true })
      .then(() => {
        quitting = true;
        app.quit();
      })
      .catch(() => {
        shutdownPending = false;
        reopen = false;
        dialog.showMessageBox({
          type: 'error',
          message: 'Bloom could not finish stopping safely',
          detail:
            'Keep Bloom open and check the recording status. Try Stop again before quitting.',
        });
      });
    return;
  }
  // The older question about a recording still being processed belongs to the sample engine
  // only; with the real engine, quitting never asks about processing (ADR 0004).
  if (
    engine?.getState().sample &&
    !quitting &&
    quitGuard &&
    !quitGuard.allows()
  )
    return event.preventDefault();
  quitting = true;
});
// macOS reopens a running app through activation rather than a second process.
app.on('activate', () => windows?.showPanel());
// GNOME desktops without the GlobalShortcuts portal can run these commands
// from their own keyboard settings while another application has focus.
async function linuxShortcut(argv) {
  if (process.platform !== 'linux' || !engine || !shortcuts) return false;
  const toggle = argv.includes('--toggle-recording');
  if (!toggle && !argv.includes('--mark-recording')) return false;
  await engine.ready;
  if (toggle) shortcuts.toggleCapture();
  else await engine.command('mark');
  return true;
}
app.on('second-instance', async (_event, argv) => {
  if (!(await linuxShortcut(argv))) windows?.showPanel();
});
app.on('window-all-closed', () => {}); // a tray app keeps running with no windows
app.on('will-quit', (event) => {
  // A downloaded update goes in as Bloom quits: quitting waits the few seconds it takes to
  // check it again and start the swap, then carries on. If Bloom was to reopen, the update
  // does it.
  if (updater?.hasUpdate()) {
    event.preventDefault();
    updater
      .applyOnQuit({ reopen })
      .then((reopens) => {
        if (reopens) reopen = false;
      })
      .catch(() => {})
      .finally(() => {
        updater.stop();
        app.quit();
      });
    return;
  }
  updater?.stop();
  if (reopen) app.relaunch();
  shortcuts?.unregister();
  tray?.dispose();
  floating?.dispose();
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
  floatingControlShowing: () => floating.isShowing(),
  // For a walkthrough that stands in for quitting: was a reopen asked for, and carry on.
  reopenAsked: () => reopen,
  stayOpen() {
    quitting = false;
    shutdownPending = false;
    reopen = false;
  },
  floatingCameraShowing: () => floating.cameraShowing(),
};
