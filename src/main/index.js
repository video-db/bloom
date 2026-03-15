'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, Notification } = require('electron');
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
let tray = null;
let videodbService = null;
let isShuttingDown = false;
let isRecording = false;

// ============================================================================
// Window Creation
// ============================================================================

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 340,
    minHeight: 300,
    maxHeight: 420,
    minWidth: 340,
    maxWidth: 480,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(RENDERER_DIR, 'index.html'));
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

function createHistoryWindow() {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.show();
    historyWindow.focus();
    return;
  }

  historyWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Recording History',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  historyWindow.loadFile(path.join(RENDERER_DIR, 'history.html'));
  historyWindow.on('closed', () => { historyWindow = null; });
}

// ============================================================================
// System Tray
// ============================================================================

/**
 * Create a macOS template tray icon (black on transparent, 36x36 @2x).
 * @param {boolean} filled - true for filled circle (recording), false for outline (idle)
 */
function createTrayIcon(filled) {
  const size = 36; // 18pt @2x retina
  const buf = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const radius = filled ? 7 : 8;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;

      let alpha = 0;
      if (filled) {
        if (dist <= radius) alpha = 255;
        else if (dist <= radius + 1) alpha = Math.round(255 * (radius + 1 - dist));
      } else {
        const strokeHalf = 1;
        const edge = Math.abs(dist - radius);
        if (edge <= strokeHalf) alpha = 255;
        else if (edge <= strokeHalf + 1) alpha = Math.round(255 * (strokeHalf + 1 - edge));
      }

      buf[idx] = 0;         // R
      buf[idx + 1] = 0;     // G
      buf[idx + 2] = 0;     // B
      buf[idx + 3] = alpha;  // A
    }
  }

  const img = nativeImage.createFromBuffer(buf, { width: size, height: size, scaleFactor: 2.0 });
  img.setTemplateImage(true);
  return img;
}

function createTray() {
  tray = new Tray(createTrayIcon(false));
  tray.setToolTip('Async Recorder');
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setImage(createTrayIcon(isRecording));
  const menu = Menu.buildFromTemplate([
    {
      label: isRecording ? 'Stop Recording' : 'Start Recording',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recorder-event', { event: 'shortcut:toggle-recording', data: {} });
          mainWindow.show();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'History',
      click: () => createHistoryWindow(),
    },
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(isRecording ? 'Async Recorder — Recording...' : 'Async Recorder');
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
  syncOrphanedSessions(apiKey, videodbService);

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

function _getCurrentUserApiKey() {
  const { accessToken } = getAppConfig();
  if (!accessToken) return null;
  const user = findUserByToken(accessToken);
  return user ? user.api_key : null;
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

  ipcMain.handle('open-history-window', () => {
    createHistoryWindow();
    return { success: true };
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
      mainWindow.show();
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
