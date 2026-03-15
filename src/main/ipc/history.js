'use strict';

const { ipcMain } = require('electron');
const { getRecordings: dbGetRecordings, updateRecording, findRecordingBySessionId } = require('../db/database');
const { getAppConfig } = require('../lib/config');
const { findUserByToken } = require('../db/database');

/**
 * Register recording history IPC handlers.
 * @param {Function} getVideodbService - returns the VideoDBService singleton
 */
function registerHistoryHandlers(getVideodbService) {
  ipcMain.handle('get-recordings', async () => {
    try {
      const recordings = dbGetRecordings(20);
      return recordings.map(r => ({
        id: r.id,
        name: r.name,
        video_id: r.video_id,
        session_id: r.session_id,
        stream_url: r.stream_url,
        player_url: r.player_url,
        created_at: r.created_at,
        insights_status: r.insights_status,
        insights: r.insights,
      }));
    } catch (error) {
      console.error('Failed to get recordings:', error);
      return [];
    }
  });

  ipcMain.handle('get-share-url', async (_event, videoId) => {
    try {
      const apiKey = _getCurrentUserApiKey();
      if (!apiKey) return { success: false, error: 'Not authenticated' };
      const videodbService = getVideodbService();
      const urls = await videodbService.getShareUrl(apiKey, videoId);
      return { success: true, ...urls };
    } catch (error) {
      console.error('Error getting share URL:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update-recording-name', async (_event, id, name) => {
    try {
      let recordingId = id;
      // Sidebar passes session_id strings; history page passes integer ids
      if (typeof id === 'string') {
        const rec = findRecordingBySessionId(id);
        if (!rec) return { success: false, error: 'Recording not found' };
        recordingId = rec.id;
      }
      updateRecording(recordingId, { name });
      return { success: true };
    } catch (error) {
      console.error('Error updating recording name:', error);
      return { success: false, error: error.message };
    }
  });
}

function _getCurrentUserApiKey() {
  const { accessToken } = getAppConfig();
  if (!accessToken) return null;
  const user = findUserByToken(accessToken);
  return user ? user.api_key : null;
}

module.exports = { registerHistoryHandlers };
