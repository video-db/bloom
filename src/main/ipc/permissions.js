'use strict';

const { ipcMain, systemPreferences, shell } = require('electron');

/**
 * Register permission-related IPC handlers (check, request, open settings).
 */
function registerPermissionHandlers() {
  ipcMain.handle('check-mic-permission', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('microphone');
    }
    return 'granted';
  });

  ipcMain.handle('check-screen-permission', () => {
    if (process.platform === 'darwin') {
      try {
        return systemPreferences.getMediaAccessStatus('screen') || 'unknown';
      } catch (error) {
        console.error('Screen permission check error:', error);
        return 'error';
      }
    }
    return 'granted';
  });

  ipcMain.handle('request-mic-permission', async () => {
    if (process.platform === 'darwin') {
      try {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        return { granted, status: granted ? 'granted' : 'denied' };
      } catch (error) {
        console.error('Mic permission error:', error);
        return { granted: false, status: 'error', message: error.message };
      }
    }
    return { granted: true, status: 'granted' };
  });

  ipcMain.handle('check-camera-permission', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('camera');
    }
    return 'granted';
  });

  ipcMain.handle('request-camera-permission', async () => {
    if (process.platform === 'darwin') {
      try {
        const granted = await systemPreferences.askForMediaAccess('camera');
        return { granted, status: granted ? 'granted' : 'denied' };
      } catch (error) {
        console.error('Camera permission error:', error);
        return { granted: false, status: 'error', message: error.message };
      }
    }
    return { granted: true, status: 'granted' };
  });

  ipcMain.handle('open-system-settings', async (_event, type) => {
    try {
      let url = '';

      if (process.platform === 'darwin') {
        if (type === 'mic') url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
        else if (type === 'screen') url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
        else if (type === 'camera') url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera';
      } else if (process.platform === 'win32') {
        if (type === 'mic') url = 'ms-settings:privacy-microphone';
        else if (type === 'camera') url = 'ms-settings:privacy-webcam';
        else if (type === 'screen') url = 'ms-settings:privacy';
      }

      if (url) {
        console.log(`Open System Settings: ${url}`);
        await shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: 'Unknown type or unsupported platform' };
    } catch (error) {
      console.error('Failed to open system settings:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerPermissionHandlers };
