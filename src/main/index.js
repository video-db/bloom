'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, Notification, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// --- Lib ---
const { initLogger } = require('./lib/logger');
const { DB_FILE, AUTH_CONFIG_FILE, RENDERER_DIR, PRELOAD_SCRIPT } = require('./lib/paths');
const { loadUserConfig, saveUserConfig, getAppConfig } = require('./lib/config');

// --- Database ---
const { initDatabase, closeDatabase, findUserByApiKey, createUser, findUserByToken } = require('./db/database');

// --- Services ---
const { VideoDBService } = require('./services/videodb.service');
const { syncOrphanedSessions, shutdownSession } = require('./services/session.service');

// --- IPC ---
const { registerAllHandlers } = require('./ipc');

// ============================================================================
// App State
// ============================================================================

let mainWindow = null;
let cameraWindow = null;
let historyWindow = null;
let modalWindow = null;
let displayPickerWindow = null;
let pendingDisplayPickerResolve = null;
let removeDisplayPickerParentListeners = null;
let tray = null;
let videodbService = null;
let isShuttingDown = false;
let isRecording = false;

// ============================================================================
// Window Creation
// ============================================================================

function createMainWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const barWidth = 940;
  const windowHeight = 120;  // 52px bar + 6px bottom margin + ~62px shadow headroom
  const marginBottom = 8;

  mainWindow = new BrowserWindow({
    width: barWidth,
    height: windowHeight,
    x: Math.round((screenWidth - barWidth) / 2),
    y: screenHeight - windowHeight - marginBottom,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setContentProtection(true);
  // setVisibleOnAllWorkspaces can force-show on macOS — hide again
  mainWindow.hide();

  // Restore dock icon — setVisibleOnAllWorkspaces can hide it on some macOS versions
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }

  // Click-through: transparent area passes clicks to apps behind.
  // Renderer toggles this off when mouse enters the bar element.
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(RENDERER_DIR, 'index.html'));
}

// ============================================================================
// Display Picker (separate child window)
// ============================================================================

function resolveDisplayPicker(result) {
  if (!pendingDisplayPickerResolve) return;
  const resolve = pendingDisplayPickerResolve;
  pendingDisplayPickerResolve = null;
  resolve(result);
}

function detachDisplayPickerParentListeners() {
  if (removeDisplayPickerParentListeners) {
    removeDisplayPickerParentListeners();
    removeDisplayPickerParentListeners = null;
  }
}

function closeDisplayPicker(result = { cancelled: true }) {
  resolveDisplayPicker(result);
  detachDisplayPickerParentListeners();

  if (displayPickerWindow && !displayPickerWindow.isDestroyed()) {
    const w = displayPickerWindow;
    displayPickerWindow = null;
    w.close();
  } else {
    displayPickerWindow = null;
  }
}

function openDisplayPicker(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ cancelled: true });
  }

  // Close any existing picker
  closeDisplayPicker({ cancelled: true });

  const { screen } = require('electron');
  const displays = Array.isArray(payload?.displays) ? payload.displays : [];
  const selectedDisplayId = payload?.selectedDisplayId || null;

  // Compute bounds — position above the anchor pill
  const itemHeight = 34;
  const maxItems = 7;
  const contentHeight = Math.max(40, Math.min(displays.length, maxItems) * itemHeight);
  const width = Math.max(180, Math.min(Number(payload?.preferredWidth) || 220, 400));

  const anchorRect = payload?.anchorRect || {};
  const parentBounds = mainWindow.getBounds();
  const anchorCenterX = parentBounds.x + (Number(anchorRect.x) || 0) + Math.round((Number(anchorRect.width) || 0) / 2);
  const anchorTopY = parentBounds.y + (Number(anchorRect.y) || 0);

  let x = Math.round(anchorCenterX - width / 2);
  let y = Math.round(anchorTopY - contentHeight - 12);

  // Clamp to screen work area
  const nearest = screen.getDisplayNearestPoint({ x: anchorCenterX, y: anchorTopY });
  const wa = nearest.workArea;
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - width - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - contentHeight - 8));

  return new Promise((resolve) => {
    pendingDisplayPickerResolve = resolve;

    displayPickerWindow = new BrowserWindow({
      width,
      height: contentHeight,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: true,
      parent: mainWindow,
      webPreferences: {
        preload: PRELOAD_SCRIPT,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Close picker when parent moves/hides
    const onParentChange = () => closeDisplayPicker({ cancelled: true });
    mainWindow.on('move', onParentChange);
    mainWindow.on('resize', onParentChange);
    mainWindow.on('hide', onParentChange);
    mainWindow.on('closed', onParentChange);

    removeDisplayPickerParentListeners = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.off('move', onParentChange);
      mainWindow.off('resize', onParentChange);
      mainWindow.off('hide', onParentChange);
      mainWindow.off('closed', onParentChange);
    };

    displayPickerWindow.on('blur', () => closeDisplayPicker({ cancelled: true }));

    // Guard: only clean up if this is still the current picker (prevents
    // race when fast clicks create a new picker before the old one's
    // 'closed' event fires).
    const thisWindow = displayPickerWindow;
    displayPickerWindow.on('closed', () => {
      if (displayPickerWindow === thisWindow) {
        displayPickerWindow = null;
        detachDisplayPickerParentListeners();
        resolveDisplayPicker({ cancelled: true });
      }
    });

    displayPickerWindow.loadFile(path.join(RENDERER_DIR, 'display-picker.html'));
    displayPickerWindow.webContents.once('did-finish-load', () => {
      if (!displayPickerWindow || displayPickerWindow.isDestroyed()) return;
      displayPickerWindow.webContents.send('display-picker:init', { displays, selectedDisplayId });
      displayPickerWindow.show();
      displayPickerWindow.focus();
    });
  });
}

function createCameraWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const bubbleSize = 250;
  const margin = 20;

  cameraWindow = new BrowserWindow({
    width: bubbleSize,
    height: bubbleSize,
    x: screenWidth - bubbleSize - margin,
    y: screenHeight - bubbleSize - margin,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  cameraWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Restore dock icon — setVisibleOnAllWorkspaces can hide it on some macOS versions
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }
}

function createHistoryWindow(focusSessionId) {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.show();
    historyWindow.focus();
    if (focusSessionId) {
      historyWindow.webContents.send('history:focus-recording', focusSessionId);
    }
    return;
  }

  historyWindow = new BrowserWindow({
    width: 1120,
    height: 700,
    title: 'Library',
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  historyWindow.loadFile(path.join(RENDERER_DIR, 'history.html'));
  historyWindow.on('closed', () => { historyWindow = null; });

  if (focusSessionId) {
    historyWindow.webContents.once('did-finish-load', () => {
      historyWindow.webContents.send('history:focus-recording', focusSessionId);
    });
  }
}

function createModalWindow(page) {
  if (modalWindow && !modalWindow.isDestroyed()) {
    modalWindow.focus();
    return modalWindow;
  }

  const theme = getAppConfig().theme || 'dark';
  const sizes = {
    permissions: { width: 560, height: 640 },
    onboarding: { width: 480, height: 520 },
  };
  const size = sizes[page] || { width: 480, height: 400 };

  modalWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    center: true,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: theme === 'light' ? '#faf9f7' : '#0c0c0d',
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  modalWindow.loadFile(path.join(RENDERER_DIR, `${page}.html`));
  modalWindow.on('closed', () => { modalWindow = null; });
  return modalWindow;
}

// ============================================================================
// System Tray
// ============================================================================

/**
 * Create a tray icon (36x36 @2x). Circle-in-circle design.
 * Idle: black template image (macOS adapts to menu bar).
 * Recording: red (#FD5337), non-template so color is preserved.
 */
function createTrayIcon(recording) {
  const size = 36; // 18pt @2x retina
  const buf = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const outerRadius = 13.5;
  const outerStroke = 1.5;
  const innerRadius = 5.5;

  const r = recording ? 0xFD : 0;
  const g = recording ? 0x53 : 0;
  const b = recording ? 0x37 : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;

      let alpha = 0;

      // Inner filled circle
      if (dist <= innerRadius) {
        alpha = 255;
      } else if (dist <= innerRadius + 1) {
        alpha = Math.round(255 * (innerRadius + 1 - dist));
      }

      // Outer ring
      const edge = Math.abs(dist - outerRadius);
      if (edge <= outerStroke / 2) {
        alpha = 255;
      } else if (edge <= outerStroke / 2 + 1) {
        alpha = Math.max(alpha, Math.round(255 * (outerStroke / 2 + 1 - edge)));
      }

      // macOS expects BGRA byte order
      buf[idx] = b;
      buf[idx + 1] = g;
      buf[idx + 2] = r;
      buf[idx + 3] = alpha;
    }
  }

  const img = nativeImage.createFromBuffer(buf, { width: size, height: size, scaleFactor: 2.0 });
  img.setTemplateImage(!recording);
  return img;
}

function createTray() {
  tray = new Tray(createTrayIcon(false));
  tray.setToolTip('Bloom');
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setImage(createTrayIcon(isRecording));

  const isAuthenticated = !!getAppConfig().accessToken;

  // Check permissions (passive — does not trigger system prompts)
  let permissionsGranted = false;
  if (isAuthenticated && process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    permissionsGranted = micStatus === 'granted' && screenStatus === 'granted';
  } else if (isAuthenticated) {
    permissionsGranted = true;
  }

  let template;

  if (!isAuthenticated) {
    // Not logged in — minimal menu
    template = [
      { label: 'Bloom', enabled: false },
      { type: 'separator' },
      {
        label: 'Get API Key',
        click: () => {
          shell.openExternal('https://console.videodb.io/dashboard');
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ];
  } else if (!permissionsGranted) {
    // Logged in but permissions missing — no bar/recording controls
    template = [
      { label: 'Bloom', enabled: false },
      { type: 'separator' },
      { label: 'Library', click: () => createHistoryWindow() },
      {
        label: 'Logout',
        click: async () => {
          if (historyWindow && !historyWindow.isDestroyed()) historyWindow.close();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
            await mainWindow.webContents.executeJavaScript(`
              (async () => {
                const btn = document.getElementById('btn-start-session');
                if (btn) btn.disabled = true;
                await window.configAPI.logout();
                window.recorderAPI.showOnboardingModal();
              })()
            `);
          }
          updateTrayMenu();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ];
  } else {
    // Fully ready — full menu
    const barVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    template = [
      { label: 'Bloom', enabled: false },
      { type: 'separator' },
      {
        label: barVisible ? 'Hide Floating Bar' : 'Show Floating Bar',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
          }
          updateTrayMenu();
        },
      },
      {
        label: isRecording ? 'Stop Recording' : 'Start Recording',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('recorder-event', { event: 'shortcut:toggle-recording', data: {} });
          }
        },
      },
      { type: 'separator' },
      { label: 'Library', click: () => createHistoryWindow() },
      {
        label: 'Logout',
        click: async () => {
          if (historyWindow && !historyWindow.isDestroyed()) historyWindow.close();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
            await mainWindow.webContents.executeJavaScript(`
              (async () => {
                const btn = document.getElementById('btn-start-session');
                if (btn) btn.disabled = true;
                await window.configAPI.logout();
                window.recorderAPI.showOnboardingModal();
              })()
            `);
          }
          updateTrayMenu();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ];
  }

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(isRecording ? 'Bloom — Recording...' : 'Bloom');
}

// ============================================================================
// Services Lifecycle
// ============================================================================

async function startServices() {
  // 1. Initialize database
  console.log('Initializing database at:', DB_FILE());
  await initDatabase(DB_FILE());

  // 2. Create VideoDB service
  const apiUrl = process.env.VIDEODB_API_URL || null;
  videodbService = new VideoDBService({ baseUrl: apiUrl });

  // 3. Load user config
  loadUserConfig();

  // 4. Auto-register from auth_config.json (if exists)
  await autoRegisterFromSetup();

  // 5. Sync orphaned recordings from previous sessions
  const apiKey = _getCurrentUserApiKey();
  const userId = _getCurrentUserId();
  syncOrphanedSessions(apiKey, videodbService, userId);

  console.log('VideoDB SDK Configuration:');
  console.log('- AUTH_STATUS:', getAppConfig().accessToken ? 'Connected' : 'Needs Connection');
  console.log('- EVENT_DELIVERY: WebSocket');
  console.log('App ready (CaptureClient will be created per session)');
}

async function stopServices() {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }
  isShuttingDown = true;
  console.log('Shutting down application...');

  await shutdownSession();
  closeDatabase();
  console.log('Database closed');
}

// ============================================================================
// Auto Registration
// ============================================================================

async function autoRegisterFromSetup() {
  if (!fs.existsSync(AUTH_CONFIG_FILE)) return;

  try {
    const authConfig = JSON.parse(fs.readFileSync(AUTH_CONFIG_FILE, 'utf8'));
    const { apiKey, name } = authConfig;

    if (!apiKey) {
      console.log('No API key in auth_config.json');
      fs.unlinkSync(AUTH_CONFIG_FILE);
      return;
    }

    console.log(`Registering from setup: ${name || 'Guest'}`);

    const valid = await videodbService.verifyApiKey(apiKey);
    if (!valid) {
      console.error('Registration failed: Invalid API key');
      fs.unlinkSync(AUTH_CONFIG_FILE);
      saveUserConfig({ accessToken: null, userName: null });
      console.log('Invalid credentials - please re-enter in onboarding');
      return;
    }

    const existingUser = findUserByApiKey(apiKey);
    let accessToken;
    let userName = name || 'Guest';

    if (existingUser) {
      accessToken = existingUser.access_token;
      userName = existingUser.name;
    } else {
      accessToken = randomUUID();
      createUser(userName, apiKey, accessToken);
    }

    console.log('Registration successful!');
    saveUserConfig({ accessToken, userName });

    fs.unlinkSync(AUTH_CONFIG_FILE);
    console.log('Setup complete - auth_config.json removed');
  } catch (error) {
    console.error('Registration error:', error);
    if (fs.existsSync(AUTH_CONFIG_FILE)) {
      fs.unlinkSync(AUTH_CONFIG_FILE);
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function _getCurrentUser() {
  const { accessToken } = getAppConfig();
  if (!accessToken) return null;
  return findUserByToken(accessToken) || null;
}

function _getCurrentUserApiKey() {
  const user = _getCurrentUser();
  return user ? user.api_key : null;
}

function _getCurrentUserId() {
  const user = _getCurrentUser();
  return user ? user.id : null;
}

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(async () => {
  // 1. Init logging first (patches console.log/error/warn)
  initLogger();

  // 1b. Clean up stale recorder lock files (binary writes these; they survive crashes)
  for (const lockFile of [
    path.join(app.getPath('userData'), 'bin', 'videodb-recorder.lock'),
    path.join(app.getPath('temp'), 'videodb-recorder.lock'),
    path.join(app.getPath('home'), '.videodb-recorder.lock'),
  ]) {
    try { if (fs.existsSync(lockFile)) { fs.unlinkSync(lockFile); console.log('Removed stale lock:', lockFile); } } catch (_) {}
  }

  // 2. Start services (DB, VideoDB, config, orphan sync)
  try {
    await startServices();
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }

  // 3. Register IPC handlers
  registerAllHandlers({
    getVideodbService: () => videodbService,
    getMainWindow: () => mainWindow,
    getCameraWindow: () => cameraWindow,
  });

  ipcMain.handle('open-history-window', (_event, focusSessionId) => {
    createHistoryWindow(focusSessionId || null);
    return { success: true };
  });

  ipcMain.handle('show-permissions-modal', () => {
    createModalWindow('permissions');
    return { success: true };
  });

  ipcMain.handle('show-onboarding-modal', () => {
    createModalWindow('onboarding');
    return { success: true };
  });

  ipcMain.on('modal-complete', (_event, result) => {
    if (modalWindow && !modalWindow.isDestroyed()) {
      modalWindow.close();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'modal:complete',
        data: result,
      });
    }
    // Auth state may have changed — refresh tray menu
    updateTrayMenu();
  });

  // Display picker
  ipcMain.handle('open-display-picker', async (_event, payload) => {
    return openDisplayPicker(payload || {});
  });

  ipcMain.on('display-picker:select', (event, selection) => {
    if (!displayPickerWindow || displayPickerWindow.isDestroyed()) return;
    if (event.sender !== displayPickerWindow.webContents) return;
    closeDisplayPicker({ cancelled: false, id: selection?.id, name: selection?.name });
  });

  ipcMain.on('display-picker:cancel', (event) => {
    if (!displayPickerWindow || displayPickerWindow.isDestroyed()) return;
    if (event.sender !== displayPickerWindow.webContents) return;
    closeDisplayPicker({ cancelled: true });
  });

  // Click-through toggle — renderer calls this on mouseenter/mouseleave
  ipcMain.on('set-ignore-mouse', (_event, ignore) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (ignore) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.on('hide-bar', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
    // Hide camera bubble when bar is closed and not recording
    if (!isRecording && cameraWindow && !cameraWindow.isDestroyed()) {
      cameraWindow.hide();
    }
    updateTrayMenu();
  });

  ipcMain.on('show-bar', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
    updateTrayMenu();
  });

  ipcMain.on('recording-state-changed', (_event, recording) => {
    isRecording = recording;
    updateTrayMenu();
  });

  ipcMain.on('show-notification', (_event, { title, body }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  // 4. Create windows
  createMainWindow();
  createCameraWindow();
  createTray();

  // 5. Register global shortcuts
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', { event: 'shortcut:toggle-recording', data: {} });
    }
  });
});

// --- Shutdown ---

app.on('window-all-closed', async () => {
  globalShortcut.unregisterAll();
  await stopServices();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  closeDisplayPicker({ cancelled: true });
  if (!isShuttingDown) {
    event.preventDefault();
    await stopServices();
    app.exit(0);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

// --- Process signals ---

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT (Ctrl+C)');
  await stopServices();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM');
  await stopServices();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
