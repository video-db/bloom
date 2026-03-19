'use strict';

const { app, ipcMain, systemPreferences } = require('electron');
const { CaptureClient } = require('videodb/capture');
const { applyVideoDBPatches } = require('../lib/videodb-patch');
const { getAppConfig } = require('../lib/config');
const { findUserByToken, findRecordingBySessionId, updateRecording } = require('../db/database');
const { createRecording } = require('../db/database');
const {
  getSessionToken,
  syncCaptureSession,
  getCaptureClient,
  setCaptureClient,
} = require('../services/session.service');

/**
 * Register recording start/stop/pause/resume IPC handlers.
 * @param {Function} getVideodbService - returns the VideoDBService singleton
 * @param {Function} getMainWindow - returns the main BrowserWindow
 */
function registerCaptureHandlers(getVideodbService, getMainWindow) {
  ipcMain.handle('recorder-start-recording', async (_event, clientSessionId, config) => {
    try {
      console.log(`Starting recording (client reference: ${clientSessionId})`);

      const { accessToken } = getAppConfig();
      if (!accessToken) {
        return { success: false, error: 'Not authenticated. Please register first.' };
      }

      const user = findUserByToken(accessToken);
      if (!user) {
        return { success: false, error: 'User not found. Please register first.' };
      }

      const videodbService = getVideodbService();

      // 1. Create capture session
      console.log('Creating capture session via SDK...');
      let captureSessionId;
      let collectionId;
      try {
        const sessionData = await videodbService.createCaptureSession(user.api_key, {
          endUserId: `user-${user.id}`,
          metadata: { clientSessionId, startedAt: Date.now() },
        });
        captureSessionId = sessionData.sessionId;
        collectionId = sessionData.collectionId;
        console.log(`Capture session created: ${captureSessionId} (collection: ${collectionId})`);
      } catch (err) {
        console.error('Error creating capture session:', err);
        return { success: false, error: 'Failed to create capture session: ' + err.message };
      }

      // 2. Save to DB immediately
      createRecording({
        session_id: captureSessionId,
        created_at: new Date().toISOString(),
        insights_status: 'recording',
        user_id: user.id,
        collection_id: collectionId,
      });

      // 3. Get session token
      const sessionToken = await getSessionToken(videodbService, user.api_key);
      if (!sessionToken) {
        return { success: false, error: 'Failed to get session token. Please register first.' };
      }

      // 4. Create CaptureClient
      if (app.isPackaged) applyVideoDBPatches();

      const captureOptions = { sessionToken };
      if (process.env.VIDEODB_API_URL) {
        captureOptions.apiUrl = process.env.VIDEODB_API_URL;
      }
      console.log('Creating CaptureClient', captureOptions);

      const captureClient = new CaptureClient(captureOptions);
      captureClient.on('error', (err) => {
        console.error('CaptureClient error:', err.message || err.type);
      });
      setCaptureClient(captureClient);

      // 5. List channels
      console.log('Listing available channels...');
      let channels;
      try {
        channels = await captureClient.listChannels();
        for (const ch of channels.all()) {
          console.log(`  - ${ch.id} (${ch.type}): ${ch.name}`);
        }
      } catch (err) {
        console.error('Failed to list channels:', err);
        return { success: false, error: 'Failed to list capture channels' };
      }

      // 6. Select channels (use renderer selections or fall back to defaults)
      const selectedChannels = config || {};
      const captureChannels = [];

      const micId = selectedChannels.micId;
      const micChannel = micId
        ? channels.mics.find(ch => ch.id === micId) || channels.mics.default
        : channels.mics.default;
      if (micChannel) {
        captureChannels.push({ channelId: micChannel.id, type: 'audio', store: true });
        console.log(`Selected mic channel: ${micChannel.id}`);
      }

      const audioId = selectedChannels.audioId;
      const systemAudioChannel = audioId
        ? channels.systemAudio.find(ch => ch.id === audioId) || channels.systemAudio.default
        : channels.systemAudio.default;
      if (systemAudioChannel) {
        captureChannels.push({ channelId: systemAudioChannel.id, type: 'audio', store: true });
        console.log(`Selected system audio channel: ${systemAudioChannel.id}`);
      }

      const displayId = selectedChannels.displayId;
      const displayChannel = displayId
        ? channels.displays.find(ch => ch.id === displayId) || channels.displays.default
        : channels.displays.default;
      if (displayChannel) {
        captureChannels.push({ channelId: displayChannel.id, type: 'video', store: true, isPrimary: true });
        console.log(`Selected display channel: ${displayChannel.id}`);
      }

      if (captureChannels.length === 0) {
        return { success: false, error: 'No capture channels available. Check permissions.' };
      }

      // 7. Check permissions
      const screenAccess = systemPreferences.getMediaAccessStatus('screen');
      const micAccess = systemPreferences.getMediaAccessStatus('microphone');
      console.log(`Permissions — screen: ${screenAccess}, microphone: ${micAccess}`);

      if (screenAccess !== 'granted') {
        return { success: false, error: 'Screen recording permission not granted. Enable in System Settings > Privacy & Security > Screen Recording, then restart.' };
      }
      if (micAccess !== 'granted') {
        console.log('Requesting microphone access...');
        const granted = await systemPreferences.askForMediaAccess('microphone');
        if (!granted) {
          return { success: false, error: 'Microphone permission denied. Enable in System Settings > Privacy & Security > Microphone, then restart.' };
        }
        console.log('Microphone access granted');
      }

      // 8. Start capture
      console.log('Starting capture session...');
      await captureClient.startSession({
        sessionId: captureSessionId,
        channels: captureChannels,
      });
      console.log('Capture session started successfully');

      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recorder-event', {
          event: 'recording:started',
          data: { sessionId: captureSessionId },
        });
      }

      return { success: true, sessionId: captureSessionId };
    } catch (error) {
      console.error('Error starting recording:', error.message, error.stack);
      return { success: false, error: error.message || 'Recording failed. Check screen recording permissions.' };
    }
  });

  ipcMain.handle('recorder-stop-recording', async (_event, sessionId) => {
    console.log(`Stopping recording for session: ${sessionId}`);

    const captureClient = getCaptureClient();
    if (!captureClient) {
      console.warn('No active capture client to stop');
      return { success: true };
    }

    try {
      await captureClient.stopSession();
      console.log('Capture session stopped');
    } catch (stopErr) {
      console.warn('CaptureClient stop warning:', stopErr.message);
    }

    try {
      await captureClient.shutdown();
      console.log('CaptureClient shutdown complete');
    } catch (shutdownErr) {
      console.warn('CaptureClient shutdown warning:', shutdownErr.message);
    }
    setCaptureClient(null);

    // Mark as processing and start polling for export in background
    const recording = findRecordingBySessionId(sessionId);
    if (recording) {
      updateRecording(recording.id, { insights_status: 'processing' });
    }

    const apiKey = _getCurrentUserApiKey();
    if (apiKey) {
      const videodbService = getVideodbService();
      syncCaptureSession(sessionId, apiKey, videodbService).catch(err => {
        console.error('[Sync] Background poll failed:', err.message);
      });
    }

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'recording:stopped',
        data: { sessionId },
      });
    }

    return { success: true };
  });

  ipcMain.handle('recorder-pause-tracks', async (_event, sessionId, tracks) => {
    try {
      console.log(`Pausing tracks for session ${sessionId}:`, tracks);
      const client = getCaptureClient();
      if (!client) throw new Error('No active capture client');
      await client.pauseTracks(tracks);
      return { success: true };
    } catch (error) {
      console.error('Error pausing tracks:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('recorder-resume-tracks', async (_event, sessionId, tracks) => {
    try {
      console.log(`Resuming tracks for session ${sessionId}:`, tracks);
      const client = getCaptureClient();
      if (!client) throw new Error('No active capture client');
      await client.resumeTracks(tracks);
      return { success: true };
    } catch (error) {
      console.error('Error resuming tracks:', error);
      return { success: false, error: error.message };
    }
  });

  // --- List available devices ---
  ipcMain.handle('list-devices', async () => {
    try {
      const apiKey = _getCurrentUserApiKey();
      if (!apiKey) {
        return { success: false, error: 'Not authenticated' };
      }

      const videodbService = getVideodbService();
      const sessionToken = await getSessionToken(videodbService, apiKey);
      if (!sessionToken) {
        return { success: false, error: 'Failed to get session token' };
      }

      if (app.isPackaged) applyVideoDBPatches();
      const tempOptions = { sessionToken };
      if (process.env.VIDEODB_API_URL) tempOptions.apiUrl = process.env.VIDEODB_API_URL;

      const tempClient = new CaptureClient(tempOptions);
      try {
        const channels = await tempClient.listChannels();

        const mics = channels.mics.map(ch => ({ id: ch.id, name: ch.name }));
        const systemAudio = channels.systemAudio.map(ch => ({ id: ch.id, name: ch.name }));
        const displays = channels.displays.map(ch => ({ id: ch.id, name: ch.name }));

        console.log(`[list-devices] mics: ${mics.length}, audio: ${systemAudio.length}, displays: ${displays.length}`);
        return { success: true, mics, systemAudio, displays };
      } finally {
        await tempClient.shutdown().catch(() => {});
      }
    } catch (error) {
      console.error('Error listing devices:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('recorder-request-permission', async (_event, type) => {
    try {
      console.log(`Requesting permission: ${type}`);
      const permissionMap = {
        'microphone': 'microphone',
        'screen': 'screen-capture',
        'screen-capture': 'screen-capture',
      };
      const sdkPermission = permissionMap[type] || type;

      const client = getCaptureClient();
      if (!client) {
        const videodbService = getVideodbService();
        const apiKey = _getCurrentUserApiKey();
        const sessionToken = apiKey ? await getSessionToken(videodbService, apiKey) : null;
        if (sessionToken) {
          if (app.isPackaged) applyVideoDBPatches();
          const tempOptions = { sessionToken };
          if (process.env.VIDEODB_API_URL) tempOptions.apiUrl = process.env.VIDEODB_API_URL;
          const tempClient = new CaptureClient(tempOptions);
          const result = await tempClient.requestPermission(sdkPermission);
          await tempClient.shutdown();
          return { success: true, status: result };
        }
        return { success: true, status: 'undetermined' };
      }

      const result = await client.requestPermission(sdkPermission);
      return { success: true, status: result };
    } catch (error) {
      console.error('Error requesting permission:', error);
      return { success: false, error: error.message };
    }
  });
}

/** Helper: get current user's API key from config + DB */
function _getCurrentUserApiKey() {
  const { accessToken } = getAppConfig();
  if (!accessToken) return null;
  const user = findUserByToken(accessToken);
  return user ? user.api_key : null;
}

module.exports = { registerCaptureHandlers };
