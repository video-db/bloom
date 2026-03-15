'use strict';

const { registerCaptureHandlers } = require('./capture');
const { registerPermissionHandlers } = require('./permissions');
const { registerConfigHandlers } = require('./config');
const { registerHistoryHandlers } = require('./history');
const { registerCameraHandlers } = require('./camera');

/**
 * Register all IPC handlers.
 *
 * @param {object} deps - Shared dependencies
 * @param {Function} deps.getVideodbService - returns VideoDBService singleton
 * @param {Function} deps.getMainWindow - returns main BrowserWindow
 * @param {Function} deps.getCameraWindow - returns camera BrowserWindow
 */
function registerAllHandlers({ getVideodbService, getMainWindow, getCameraWindow }) {
  registerCaptureHandlers(getVideodbService, getMainWindow);
  registerPermissionHandlers();
  registerConfigHandlers(getVideodbService);
  registerHistoryHandlers(getVideodbService);
  registerCameraHandlers(getCameraWindow);
}

module.exports = { registerAllHandlers };
