// Entry point for the new Bloom interface (design study 02).
// Runs beside the shipping app without touching it: separate entry, separate user data.
// Capture is supplied by src/next/engine; today that is sample data only.
const path = require('node:path');
const {
  app,
  BrowserWindow,
  Tray,
  nativeImage,
  nativeTheme,
  ipcMain,
  Notification,
  clipboard,
  globalShortcut,
  screen,
  shell,
  Menu,
  dialog,
} = require('electron');
const { createEngine } = require('./engine');
const { createPrefs } = require('./prefs');

app.setName('Bloom Next');
app.setPath('userData', path.join(app.getPath('appData'), 'bloom-next'));

const ASSETS = path.join(__dirname, 'assets');
const UI = path.join(__dirname, 'ui');
const flag = (name) =>
  process.argv.includes(`--${name}`) ||
  process.env[`BLOOM_NEXT_${name.toUpperCase().replace(/-/g, '_')}`] === '1';

let forcedTheme = flag('light') ? 'light' : flag('dark') ? 'dark' : null; // lets either theme be reviewed on any machine
if (forcedTheme) nativeTheme.themeSource = forcedTheme;

let engine, prefs, tray, panel, mainWindow, onboarding;
let quitting = false,
  mainReady = false,
  pendingMainView = null,
  onboardingSession = null;
const alive = (window) => !!window && !window.isDestroyed();
const sessionNotifications = new Map();
let nudged = false,
  pausedAt = null,
  pauseNotified = false,
  resultNotification = null,
  resultStage = null,
  reducedMotion = false,
  trayKey = '';
let prefError = '';
const outOfSight = () =>
  !(alive(panel) && panel.isVisible()) &&
  !(alive(mainWindow) && mainWindow.isFocused()) &&
  !(alive(onboarding) && onboarding.isFocused());
let trayTimer = null,
  trayFrame = 0,
  lastPhase = null,
  lastAsk = null;

const img = (file) =>
  nativeImage.createFromPath(path.join(ASSETS, 'tray', file));
const frames = (dir, count, suffix) =>
  Array.from({ length: count }, (_, i) =>
    img(`${dir}/bloom-${dir}-${String(i).padStart(2, '0')}${suffix}.png`),
  );
const clock = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
// Matches --paper in ui/tokens.css so a window never flashes the wrong colour before its page paints.
const paper = () => (nativeTheme.shouldUseDarkColors ? '#17171a' : '#ffffff');
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

// ---- tray: the icon is the status light ---------------------------------------------------
function paintTray(state) {
  if (!tray) return;
  const animate = (set, ms) => {
    clearInterval(trayTimer);
    trayFrame = 0;
    tray.setImage(set[0]);
    if (reducedMotion) return;
    trayTimer = setInterval(() => {
      trayFrame = (trayFrame + 1) % set.length;
      tray.setImage(set[trayFrame]);
    }, ms);
  };
  const key = `${state.phase}:${!!state.problem}:${reducedMotion}`;
  if (key !== trayKey) {
    trayKey = key;
    clearInterval(trayTimer);
    trayTimer = null;
    if (state.phase === 'recording') animate(tray.recFrames, 130);
    else if (state.phase === 'starting' || state.phase === 'saving')
      animate(tray.busyFrames, 140);
    else if (state.phase === 'paused')
      tray.setImage(img('bloom-pausedTemplate.png'));
    else if (
      state.phase === 'stopped' ||
      state.phase === 'processing-error' ||
      state.problem
    )
      tray.setImage(img('bloom-warning.png'));
    else tray.setImage(img('bloomTemplate.png'));
  }
  const title =
    {
      starting: ' Starting',
      recording: ` ${clock(state.elapsed)}${state.ask ? '  Stop?' : ''}`,
      paused: ` ${clock(state.elapsed)}`,
      saving: ' Saving',
    }[state.phase] || '';
  tray.setTitle(title, { fontType: 'monospacedDigit' });
  tray.setToolTip(state.phase === 'recording' ? 'Bloom is recording' : 'Bloom');
}

// ---- panel: hangs from the tray icon, closes back into it ---------------------------------
function createPanel() {
  panel = new BrowserWindow({
    width: 340,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: paper(), // solid: a translucent panel turned grey over the desktop
    webPreferences,
  });
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.loadFile(path.join(UI, 'panel.html'));
  panel.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      panel.hide();
    }
  });
  panel.on('blur', () => {
    if (!flag('keep-open') && !panel.webContents.isDevToolsOpened())
      panel.hide();
  });
}

function placePanel() {
  const t = tray.getBounds();
  const [w, h] = panel.getSize();
  const area = screen.getDisplayNearestPoint({ x: t.x, y: t.y }).workArea;
  const x = Math.round(
    Math.min(
      Math.max(t.x + t.width / 2 - w / 2, area.x + 8),
      area.x + area.width - w - 8,
    ),
  );
  const y = Math.round(
    Math.max(
      area.y,
      Math.min(
        process.platform === 'darwin'
          ? t.y + t.height + 6
          : area.y + area.height - h - 8,
        area.y + area.height - h,
      ),
    ),
  );
  panel.setPosition(x, y, false);
}

function showPanel() {
  if (!alive(panel)) {
    createPanel();
    panel.once('ready-to-show', showPanel);
    return;
  }
  placePanel();
  panel.show();
  panel.focus();
}
function togglePanel() {
  if (alive(panel) && panel.isVisible()) panel.hide();
  else showPanel();
}

// ---- main window: library and editor -------------------------------------------------------
function openMain(view) {
  if (typeof view === 'string') pendingMainView = view;
  if (alive(mainWindow)) {
    mainWindow.show();
    mainWindow.focus();
    if (mainReady && pendingMainView) {
      mainWindow.webContents.send('next:view', pendingMainView);
      pendingMainView = null;
    }
    return;
  }
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    backgroundColor: paper(),
    webPreferences,
  });
  mainWindow = window;
  mainReady = false;
  window.webContents.on('did-start-loading', () => {
    if (mainWindow === window) mainReady = false;
  });
  window.loadFile(path.join(UI, 'main.html'), { hash: view || 'library' });
  window.once('ready-to-show', () => {
    if (alive(window)) window.show();
  });
  // Native close is asynchronous; a new request must not target the window being closed.
  const release = () => {
    if (mainWindow === window) {
      mainWindow = null;
      mainReady = false;
    }
  };
  window.on('close', release);
  window.on('closed', release);
}

function openOnboarding() {
  if (
    engine &&
    ['starting', 'recording', 'paused', 'saving'].includes(
      engine.getState().phase,
    )
  ) {
    showPanel();
    return;
  }
  if (onboarding && !onboarding.isDestroyed()) {
    onboarding.show();
    onboarding.focus();
    return;
  }
  onboardingSession = null;
  onboarding = new BrowserWindow({
    width: 440,
    height: 620,
    resizable: false,
    fullscreenable: false,
    titleBarStyle: 'hiddenInset',
    show: false,
    backgroundColor: paper(),
    webPreferences,
  });
  onboarding.loadFile(path.join(UI, 'onboarding.html'));
  onboarding.once('ready-to-show', () => onboarding.show());
  onboarding.on('closed', () => {
    onboarding = null;
    const state = engine.getState();
    if (onboardingSession && state.sessionId === onboardingSession) {
      if (state.phase === 'starting') engine.command('cancel');
      else if (['recording', 'paused'].includes(state.phase))
        engine.command('stop');
    }
    onboardingSession = null;
  });
}

// ---- notifications: only when Bloom is out of sight, always with the next action -----------
function notify({ title, body, actions = [], onAction, onClick, sticky }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body,
    silent: true,
    timeoutType: sticky ? 'never' : 'default',
    actions: actions.map((text) => ({ type: 'button', text })),
  });
  n.on('action', (_e, index) => onAction && onAction(index));
  n.on('click', () => (onClick ? onClick() : showPanel()));
  n.show();
  return n;
}

// Notifications are retired with their capture session, even if macOS retains a banner.
function sessionNotify(key, state, condition, options) {
  const sessionId = state.sessionId;
  if (!sessionId) return;
  sessionNotifications.get(key)?.notification?.close();
  const active = () => {
    const now = engine.getState();
    return now.sessionId === sessionId && condition(now);
  };
  const notification = notify({
    ...options,
    onAction: (index) => {
      if (active()) options.onAction?.(index);
    },
    onClick: () => {
      if (active()) (options.onClick || showPanel)();
    },
  });
  sessionNotifications.set(key, { notification, sessionId, condition });
}

function retireNotifications(state) {
  for (const [key, item] of sessionNotifications) {
    if (item.sessionId !== state.sessionId || !item.condition(state)) {
      item.notification?.close();
      sessionNotifications.delete(key);
    }
  }
}

function react(state) {
  retireNotifications(state);
  if (
    state.phase === 'finished' &&
    state.result &&
    `${state.result.id}:${state.result.stage}` !== resultStage
  ) {
    const ready = state.result.stage === 2;
    if (state.result.stage === 0 || ready) {
      resultNotification?.close();
      resultNotification = null;
      if (outOfSight() && prefs.all().notifyLinkReady)
        resultNotification = notify({
          title: ready ? 'Ready to edit' : 'Link ready (sample)',
          body: state.result.title,
          actions: ['Open recording'],
          onAction: () => {
            if (
              engine.getState().recordings.some((r) => r.id === state.result.id)
            )
              openMain(`editor/${state.result.id}`);
          },
          onClick: () => {
            if (
              engine.getState().recordings.some((r) => r.id === state.result.id)
            )
              openMain(`editor/${state.result.id}`);
          },
        });
    }
    resultStage = `${state.result.id}:${state.result.stage}`;
  }
  if (state.phase !== 'finished') {
    resultStage = null;
    resultNotification?.close();
    resultNotification = null;
  }
  if (state.phase !== lastPhase && state.phase === 'stopped' && outOfSight())
    sessionNotify('stopped', state, (s) => s.phase === 'stopped', {
      title: 'Recording stopped (sample)',
      body: `Connection lost at ${clock(state.problem.at)}. Review recovery options.`,
      actions: ['Try again', 'Keep recording so far'],
      sticky: true,
      onAction: (i) => engine.command(i === 0 ? 'retry' : 'keep'),
    });
  if (
    state.ask &&
    state.ask !== lastAsk &&
    outOfSight() &&
    prefs.all().notifyMeetingEnded
  )
    sessionNotify('meeting', state, (s) => s.phase === 'recording' && !!s.ask, {
      title: 'Meeting ended?',
      body: `Still recording ${state.sources.screen} · ${clock(state.elapsed)}`,
      actions: ['Review', 'Keep recording'],
      sticky: true,
      onAction: (i) =>
        i === 0 ? showPanel() : engine.command('answerAsk', { stop: false }),
    });
  if (state.phase === 'paused') {
    if (pausedAt === null) pausedAt = Date.now();
  } else {
    pausedAt = null;
    pauseNotified = false;
  }
}

function nudge(state) {
  if (state.phase === 'idle' || state.phase === 'starting') nudged = false;
  const minutes = prefs.all().nudgeMinutes;
  if (
    state.phase !== 'recording' ||
    !minutes ||
    nudged ||
    state.elapsed < minutes * 60 ||
    !outOfSight()
  )
    return;
  nudged = true;
  sessionNotify('long-recording', state, (s) => s.phase === 'recording', {
    title: `Still recording · ${clock(state.elapsed)}`,
    body: `${state.sources.screen} · Review capture sources in Bloom.`,
    actions: ['Keep going', 'Stop'],
    onAction: (i) => i === 1 && engine.command('stop'),
  });
}

const reminderTimer = setInterval(() => {
  if (!engine) return;
  nudge(engine.getState());
  if (
    pausedAt !== null &&
    !pauseNotified &&
    Date.now() - pausedAt >= 5 * 60000 &&
    outOfSight()
  ) {
    pauseNotified = true;
    sessionNotify('paused', engine.getState(), (s) => s.phase === 'paused', {
      title: 'Still paused',
      body: 'Nothing is being captured.',
      actions: ['Resume', 'Stop'],
      sticky: true,
      onAction: (i) => engine.command(i === 0 ? 'resume' : 'stop'),
    });
  }
}, 1000);

// Preferences that change the app itself rather than a window.
function applyPrefs() {
  const p = prefs.all();
  if (!forcedTheme) nativeTheme.themeSource = p.appearance;
  engine.command('configure', {
    sources: {
      mic: p.defaultMic,
      systemAudio: p.defaultSystemAudio,
      camera: p.defaultCamera,
    },
  });
}

const withPrefs = (state) => ({ ...state, prefs: prefs.all(), prefError });

const copyLink = () =>
  clipboard.writeText('https://example.invalid/sample-recording'); // sample data: there is no real link yet

function broadcast(state) {
  paintTray(state);
  react(state);
  nudge(state);
  lastPhase = state.phase;
  lastAsk = state.ask;
  for (const w of [panel, mainWindow, onboarding])
    if (w && !w.isDestroyed())
      w.webContents.send('next:state', withPrefs(state));
}

function toggleCapture() {
  const { phase, permissions } = engine.getState();
  if (['recording', 'paused'].includes(phase)) {
    engine.command('stop');
    return;
  }
  if (!['idle', 'finished'].includes(phase)) {
    showPanel();
    return;
  }
  if (!permissions.screen) {
    showPanel();
    notify({
      title: 'Screen permission needed',
      body: 'Review permissions in Bloom. This preview simulates permission grants.',
      actions: ['Review'],
      onAction: showPanel,
    });
    return;
  }
  engine.command('start');
}

// ---- lifecycle ----------------------------------------------------------------------------------
app.whenReady().then(() => {
  engine = createEngine();
  prefs = createPrefs(
    flag('fresh') ? null : path.join(app.getPath('userData'), 'prefs.json'),
  );
  applyPrefs();
  app.setAboutPanelOptions({
    applicationName: 'Bloom Preview',
    applicationVersion: 'UI preview',
    copyright:
      'Sample data only. No recording or upload. VideoDB integration is not connected.',
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Bloom',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Settings…',
            accelerator: 'CmdOrCtrl+,',
            click: () => openMain('settings'),
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'New Recording…',
            accelerator: 'CmdOrCtrl+N',
            click: showPanel,
          },
          {
            label: 'Recordings',
            accelerator: 'CmdOrCtrl+1',
            click: () => openMain('library'),
          },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: 'Preview Scenarios',
            submenu: [
              ['permission', 'Missing permission'],
              ['connection', 'Connection lost'],
              ['meeting-ended', 'Meeting ended'],
              ['stop-failed', 'Stop failed'],
              ['upload-slow', 'Slow upload'],
              ['processing-error', 'Processing failed'],
            ].map(([kind, label]) => ({
              label,
              click: () => {
                engine.command('simulate', { kind });
                showPanel();
              },
            })),
          },
          { label: 'About Bloom Preview', click: () => app.showAboutPanel() },
          { label: 'Replay Onboarding', click: openOnboarding },
        ],
      },
    ]),
  );

  tray = new Tray(img('bloomTemplate.png'));
  tray.recFrames = frames('recording', 12, '');
  tray.busyFrames = frames('busy', 8, 'Template');
  tray.on('click', togglePanel);
  tray.on('right-click', togglePanel);

  createPanel();
  engine.onState(broadcast);
  paintTray(engine.getState());

  ipcMain.handle('next:get-state', () => withPrefs(engine.getState()));
  ipcMain.on('next:command', (event, name, args) => {
    const from = BrowserWindow.fromWebContents(event.sender);
    if (![panel, mainWindow, onboarding].includes(from) || !alive(from)) return;
    const previousSession = engine.getState().sessionId;
    engine.command(name, args);
    if (
      from === onboarding &&
      name === 'start' &&
      engine.getState().sessionId !== previousSession
    )
      onboardingSession = engine.getState().sessionId;
  });
  ipcMain.on('next:ui', (event, name, args = {}) => {
    const from = BrowserWindow.fromWebContents(event.sender);
    if (
      ![panel, mainWindow, onboarding].includes(from) ||
      !alive(from) ||
      typeof name !== 'string' ||
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args)
    )
      return;
    if (name === 'main-ready' && from === mainWindow) {
      mainReady = true;
      if (pendingMainView) {
        mainWindow.webContents.send('next:view', pendingMainView);
        pendingMainView = null;
      }
      return;
    }
    if (
      name === 'panel-height' &&
      from === panel &&
      Number.isFinite(args.height)
    ) {
      const t = tray.getBounds(),
        area = screen.getDisplayNearestPoint({ x: t.x, y: t.y }).workArea;
      panel.setSize(
        340,
        Math.max(160, Math.min(area.height - 16, 640, Math.round(args.height))),
        false,
      );
      if (panel.isVisible()) placePanel();
    }
    if (name === 'reduced-motion' && typeof args.value === 'boolean') {
      reducedMotion = !!args.value;
      paintTray(engine.getState());
    }
    if (name === 'preview-help') app.showAboutPanel();
    if (name === 'open-preferences') {
      panel.hide();
      openMain('settings');
    }
    if (name === 'close-panel') panel.hide();
    if (name === 'set-pref' && typeof args.key === 'string') {
      const ok = prefs.set(String(args.key), args.value);
      prefError = ok
        ? ''
        : 'Could not save this preference. Check available disk space and try again.';
      if (ok) {
        if (args.key === 'appearance') forcedTheme = null;
        applyPrefs();
      }
      broadcast(engine.getState());
    }
    if (
      name === 'open-main' &&
      (args.view === undefined || typeof args.view === 'string') &&
      (args.id === undefined || typeof args.id === 'string')
    ) {
      panel.hide();
      openMain(args.id ? `${args.view || 'detail'}/${args.id}` : args.view);
    }
    if (name === 'copy-link') copyLink();
    if (name === 'open-settings')
      shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
    if (name === 'onboarding-done') {
      if (!prefs.set('onboardingComplete', true)) {
        prefError =
          'Could not save setup completion. Check available disk space and try again.';
        broadcast(engine.getState());
        dialog
          .showMessageBox(from, {
            type: 'error',
            message: 'Setup could not be saved',
            detail: prefError,
          })
          .catch(() => {});
        return;
      }
      prefError = '';
      if (alive(onboarding)) onboarding.close();
      showPanel();
    }
    if (name === 'show-panel') showPanel();
    if (name === 'open-onboarding') {
      panel.hide();
      openOnboarding();
    }
    if (name === 'quit') app.quit();
  });

  globalShortcut.register('CommandOrControl+Shift+R', toggleCapture);
  globalShortcut.register('CommandOrControl+Shift+M', () =>
    engine.command('mark'),
  );

  if (flag('skip-onboarding') || prefs.all().onboardingComplete) showPanel();
  else {
    engine.command('setPermission', { key: 'screen', value: false });
    engine.command('setPermission', { key: 'mic', value: false });
    openOnboarding();
  }
  if (flag('open-preferences')) openMain('settings');
  else if (flag('open-main')) openMain('library');
});

nativeTheme.on('updated', () => {
  for (const w of [panel, mainWindow, onboarding])
    if (w && !w.isDestroyed()) w.setBackgroundColor(paper());
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {}); // a tray app keeps running with no windows
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(trayTimer);
  clearInterval(reminderTimer);
  for (const item of sessionNotifications.values()) item.notification?.close();
  resultNotification?.close();
  if (engine) engine.dispose();
});

// Test hook: lets automation reach the tray panel, which has no window chrome to click.
global.__bloomNext = {
  showPanel,
  openMain,
  toggleCapture,
  getEngine: () => engine,
  getPrefs: () => prefs.all(),
};
