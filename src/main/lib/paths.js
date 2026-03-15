'use strict';

const { app } = require('electron');
const path = require('path');

// Paths that depend on Electron's app.getPath() are computed lazily
// because this module may be required before the app 'ready' event.
let _userData = null;
function getUserData() {
  if (!_userData) _userData = app.getPath('userData');
  return _userData;
}

/** SQLite database file */
const DB_FILE       = () => path.join(getUserData(), 'async-recorder.db');

/** Persistent user auth config (accessToken, userName) */
const CONFIG_FILE   = () => path.join(getUserData(), 'config.json');

/** Application log file */
const LOG_PATH      = () => path.join(getUserData(), 'app.log');

/** One-time setup file dropped by `npm run setup` or manual placement */
const AUTH_CONFIG_FILE = path.join(__dirname, '..', '..', '..', 'auth_config.json');

/** .env file at project root */
const ENV_FILE = path.join(__dirname, '..', '..', '..', '.env');

/** Renderer directory (HTML/JS/CSS loaded by BrowserWindow) */
const RENDERER_DIR = path.join(__dirname, '..', '..', 'renderer');

/** Preload script path */
const PRELOAD_SCRIPT = path.join(__dirname, '..', '..', 'preload', 'index.js');

module.exports = {
  DB_FILE,
  CONFIG_FILE,
  LOG_PATH,
  AUTH_CONFIG_FILE,
  ENV_FILE,
  RENDERER_DIR,
  PRELOAD_SCRIPT,
};
