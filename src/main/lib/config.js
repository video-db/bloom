'use strict';

const fs = require('fs');
const { CONFIG_FILE } = require('./paths');

let appConfig = {
  accessToken: null,
  userName: null,
};

/**
 * Load persisted auth config from disk.
 */
function loadUserConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE())) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
      appConfig = { ...appConfig, ...saved };
      console.log('Loaded user config from:', CONFIG_FILE());
    }
  } catch (error) {
    console.error('Error loading user config:', error);
  }
}

/**
 * Merge new values into appConfig and persist to disk.
 * @returns {boolean} true on success
 */
function saveUserConfig(newConfig) {
  appConfig = { ...appConfig, ...newConfig };
  try {
    fs.writeFileSync(CONFIG_FILE(), JSON.stringify(appConfig, null, 2));
    console.log('User config saved:', CONFIG_FILE());
    return true;
  } catch (err) {
    console.error('Error saving user config:', err);
    return false;
  }
}

/**
 * Return current in-memory config (read-only copy).
 */
function getAppConfig() {
  return { ...appConfig };
}

/**
 * Reset in-memory config to defaults (used on logout).
 */
function resetAppConfig() {
  appConfig = { accessToken: null, userName: null };
}

module.exports = { loadUserConfig, saveUserConfig, getAppConfig, resetAppConfig };
