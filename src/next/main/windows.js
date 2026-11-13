// The three windows: the tray panel, the main workspace and onboarding.
// Owns their creation, placement and visibility, and knows which of them a renderer message came from.
const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

const alive = (window) => !!window && !window.isDestroyed();

function createWindows({
  ui,
  preload,
  keepOpen,
  theme,
  engine,
  tray,
  isQuitting,
}) {
  let panel, mainWindow, onboarding;
  let mainReady = false,
    pendingMainView = null,
    onboardingSession = null;
  const webPreferences = {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };

  // ---- panel: hangs from the tray icon, closes back into it -------------------------------
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
      backgroundColor: theme.paper(), // solid: a translucent panel turned grey over the desktop
      webPreferences,
    });
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    panel.loadFile(path.join(ui, 'panel.html'));
    panel.on('close', (event) => {
      if (!isQuitting()) {
        event.preventDefault();
        panel.hide();
      }
    });
    panel.on('blur', () => {
      if (!keepOpen && !panel.webContents.isDevToolsOpened()) panel.hide();
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

  function hidePanel() {
    panel.hide();
  }

  // The panel grows and shrinks with its content, within the display it hangs on.
  function resizePanel(height) {
    const t = tray.getBounds(),
      area = screen.getDisplayNearestPoint({ x: t.x, y: t.y }).workArea;
    panel.setSize(
      340,
      Math.max(160, Math.min(area.height - 16, 640, Math.round(height))),
      false,
    );
    if (panel.isVisible()) placePanel();
  }

  // ---- main window: library and editor ----------------------------------------------------
  // A requested view waits here until the renderer says it can take it.
  function deliverPendingView() {
    if (!mainReady || !pendingMainView) return;
    mainWindow.webContents.send('next:view', pendingMainView);
    pendingMainView = null;
  }

  function openMain(view) {
    if (typeof view === 'string') pendingMainView = view;
    if (alive(mainWindow)) {
      mainWindow.show();
      mainWindow.focus();
      deliverPendingView();
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
      backgroundColor: theme.paper(),
      webPreferences,
    });
    mainWindow = window;
    mainReady = false;
    window.webContents.on('did-start-loading', () => {
      if (mainWindow === window) mainReady = false;
    });
    window.loadFile(path.join(ui, 'main.html'), { hash: view || 'library' });
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

  function mainRendererReady() {
    mainReady = true;
    deliverPendingView();
  }

  // ---- onboarding: first run, and replay from the Help menu -------------------------------
  function openOnboarding() {
    if (
      ['starting', 'recording', 'paused', 'saving'].includes(
        engine.getState().phase,
      )
    ) {
      showPanel();
      return;
    }
    if (alive(onboarding)) {
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
      backgroundColor: theme.paper(),
      webPreferences,
    });
    onboarding.loadFile(path.join(ui, 'onboarding.html'));
    onboarding.once('ready-to-show', () => onboarding.show());
    // Closing onboarding ends only the capture it started itself.
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

  function closeOnboarding() {
    if (alive(onboarding)) onboarding.close();
  }

  // ---- all windows ------------------------------------------------------------------------
  const open = () => [panel, mainWindow, onboarding].filter(alive);

  // 'panel' | 'main' | 'onboarding', or null for anything that is not one of our live windows.
  function roleOf(window) {
    if (!alive(window)) return null;
    if (window === panel) return 'panel';
    if (window === mainWindow) return 'main';
    if (window === onboarding) return 'onboarding';
    return null;
  }

  // True when the user cannot currently see Bloom, so a notification is worth sending.
  const outOfSight = () =>
    !(alive(panel) && panel.isVisible()) &&
    !(alive(mainWindow) && mainWindow.isFocused()) &&
    !(alive(onboarding) && onboarding.isFocused());

  return {
    createPanel,
    showPanel,
    togglePanel,
    hidePanel,
    resizePanel,
    openMain,
    mainRendererReady,
    openOnboarding,
    closeOnboarding,
    ownOnboardingSession(sessionId) {
      onboardingSession = sessionId;
    },
    roleOf,
    outOfSight,
    send(channel, payload) {
      for (const w of open()) w.webContents.send(channel, payload);
    },
    repaint() {
      for (const w of open()) w.setBackgroundColor(theme.paper());
    },
  };
}

module.exports = { createWindows };
