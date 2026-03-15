'use strict';

const { ipcMain, systemPreferences, shell } = require('electron');
const path = require('path');
const { RENDERER_DIR } = require('../lib/paths');

let cameraLoaded = false;

/**
 * Register camera bubble IPC handlers.
 * @param {Function} getCameraWindow - returns the camera BrowserWindow
 */
function registerCameraHandlers(getCameraWindow) {
  ipcMain.handle('camera-show', async () => {
    const cameraWindow = getCameraWindow();
    if (cameraWindow && !cameraWindow.isDestroyed()) {
      if (process.platform === 'darwin') {
        const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
        console.log('[Camera] Current permission status:', cameraStatus);

        if (cameraStatus !== 'granted') {
          console.log('[Camera] Requesting camera permission...');
          const granted = await systemPreferences.askForMediaAccess('camera');
          console.log('[Camera] Permission granted:', granted);
          if (!granted) {
            shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
            return { success: false, error: 'Camera permission denied' };
          }
        }
      }

      if (!cameraLoaded) {
        cameraWindow.loadFile(path.join(RENDERER_DIR, 'camera.html'));
        cameraLoaded = true;
      }
      cameraWindow.showInactive();
      return { success: true };
    }
    return { success: false, error: 'Camera window not found' };
  });

  ipcMain.handle('camera-hide', () => {
    const cameraWindow = getCameraWindow();
    if (cameraWindow && !cameraWindow.isDestroyed()) {
      cameraWindow.hide();
      return { success: true };
    }
    return { success: false, error: 'Camera window not found' };
  });
}

/**
 * Reset camera loaded state (e.g. if window is recreated).
 */
function resetCameraLoaded() {
  cameraLoaded = false;
}

module.exports = { registerCameraHandlers, resetCameraLoaded };
