'use strict';

const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { getRecordings: dbGetRecordings, updateRecording, findRecordingBySessionId, getRecordingById } = require('../db/database');
const { getAppConfig } = require('../lib/config');
const { findUserByToken } = require('../db/database');
const { checkPendingRecordings } = require('../services/session.service');

/**
 * Register recording history IPC handlers.
 * @param {Function} getVideodbService - returns the VideoDBService singleton
 */
function registerHistoryHandlers(getVideodbService) {
  ipcMain.handle('get-recordings', async () => {
    try {
      const user = _getCurrentUser();
      const recordings = dbGetRecordings(20, user ? user.id : null);
      return recordings.map(r => ({
        id: r.id,
        name: r.name,
        video_id: r.video_id,
        collection_id: r.collection_id,
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

  ipcMain.handle('sync-pending-recordings', async () => {
    try {
      const user = _getCurrentUser();
      if (!user) return { success: false, error: 'Not authenticated' };
      const videodbService = getVideodbService();
      const resolved = await checkPendingRecordings(user.api_key, videodbService, user.id);
      return { success: true, resolved };
    } catch (error) {
      console.error('Error syncing pending recordings:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('download-video', async (_event, videoId) => {
    try {
      const apiKey = _getCurrentUserApiKey();
      if (!apiKey) return { success: false, error: 'Not authenticated' };

      const videodbService = getVideodbService();
      const { url, name } = await videodbService.getVideoDownloadUrl(apiKey, videoId);
      if (!url) return { success: false, error: 'No download URL available' };

      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: name,
        filters: [{ name: 'Video', extensions: ['mp4'] }],
      });
      if (canceled || !filePath) return { success: false, error: 'Cancelled' };

      // Download the file
      const response = await fetch(url);
      if (!response.ok) return { success: false, error: `Download failed (${response.status})` };

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      shell.showItemInFolder(filePath);
      return { success: true, filePath };
    } catch (error) {
      console.error('Error downloading video:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('download-transcript', async (_event, recordingId) => {
    try {
      const apiKey = _getCurrentUserApiKey();
      if (!apiKey) return { success: false, error: 'Not authenticated' };

      // Try local DB first
      const recording = getRecordingById(recordingId);
      let transcriptText = null;

      if (recording?.insights) {
        try {
          const insights = JSON.parse(recording.insights);
          if (insights.transcript) transcriptText = insights.transcript;
        } catch (_) { /* ignore parse errors */ }
      }

      // Fall back to API if not in local DB
      if (!transcriptText && recording?.video_id) {
        const videodbService = getVideodbService();
        transcriptText = await videodbService.getTranscriptText(apiKey, recording.video_id);
      }

      if (!transcriptText) return { success: false, error: 'No transcript available' };

      const defaultName = (recording?.name || 'transcript').replace(/[^a-zA-Z0-9-_ ]/g, '') + '.txt';
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      if (canceled || !filePath) return { success: false, error: 'Cancelled' };

      fs.writeFileSync(filePath, transcriptText, 'utf-8');
      shell.showItemInFolder(filePath);
      return { success: true, filePath };
    } catch (error) {
      console.error('Error downloading transcript:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-chat-url', async (_event, videoId, collectionId) => {
    try {
      if (!videoId || !collectionId) {
        return { success: false, error: 'Video ID and Collection ID are required' };
      }
      const url = `https://chat.videodb.io?video_id=${encodeURIComponent(videoId)}&collection_id=${encodeURIComponent(collectionId)}`;
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('Error opening chat URL:', error);
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

function _getCurrentUser() {
  const { accessToken } = getAppConfig();
  if (!accessToken) return null;
  return findUserByToken(accessToken) || null;
}

function _getCurrentUserApiKey() {
  const user = _getCurrentUser();
  return user ? user.api_key : null;
}

module.exports = { registerHistoryHandlers };
