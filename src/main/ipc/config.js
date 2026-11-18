'use strict';

const { app, ipcMain, shell, BrowserWindow } = require('electron');
const { randomUUID } = require('crypto');
const { getAppConfig, saveUserConfig, resetAppConfig } = require('../lib/config');
const { CONFIG_FILE } = require('../lib/paths');
const { findUserByApiKey, createUser } = require('../db/database');
const { clearSessionToken, shutdownSession } = require('../services/session.service');
const fs = require('fs');

/**
 * Register config/auth IPC handlers (get-settings, register, logout, open-external-link).
 * @param {Function} getVideodbService - returns the VideoDBService singleton
 */
function registerConfigHandlers(getVideodbService) {
  ipcMain.handle('get-settings', () => {
    const config = getAppConfig();
    const loginSettings = app.getLoginItemSettings();
    return { ...config, isConnected: !!config.accessToken, openAtLogin: loginSettings.openAtLogin };
  });

  ipcMain.handle('save-settings', (event, data) => {
    try {
      // Apply login item setting via Electron API (not persisted in config file)
      if (data.openAtLogin !== undefined) {
        app.setLoginItemSettings({ openAtLogin: data.openAtLogin });
        delete data.openAtLogin; // Don't persist in config — Electron manages this
      }
      saveUserConfig(data);
      // Broadcast theme change to all other windows
      if (data.theme) {
        const senderId = event.sender.id;
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.webContents.id !== senderId && !win.isDestroyed()) {
            win.webContents.send('theme-changed', data.theme);
          }
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('register', async (_event, data) => {
    try {
      const { name, apiKey } = data;
      console.log(`Registering user: ${name}`);

      const videodbService = getVideodbService();
      const valid = await videodbService.verifyApiKey(apiKey);
      if (!valid) {
        return { success: false, error: 'Invalid API key. Please check your key and try again.' };
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

      console.log('Registration successful. Token generated.');
      saveUserConfig({ accessToken, userName });
      clearSessionToken();

      return { success: true, userName };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('recorder-logout', async () => {
    console.log('Logging out...');
    try {
      if (fs.existsSync(CONFIG_FILE())) {
        fs.unlinkSync(CONFIG_FILE());
        console.log('Config file deleted');
      }

      resetAppConfig();
      clearSessionToken();

      const videodbService = getVideodbService();
      if (videodbService) videodbService.clearAll();

      await shutdownSession();

      return { success: true };
    } catch (error) {
      console.error('Logout failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-external-link', async (_event, url) => {
    await shell.openExternal(url);
  });
}

module.exports = { registerConfigHandlers };
