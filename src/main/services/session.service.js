'use strict';

const { CaptureClient } = require('videodb/capture');
const { findRecordingBySessionId, updateRecording, getOrphanedRecordings } = require('../db/database');
const { indexVideo } = require('./insights.service');

// --- Singleton state ---

/** CaptureClient instance (created per recording session) */
let captureClient = null;

/** Active WebSocket connection for real-time capture events */
let wsConnection = null;

/** Timeout that force-closes WS if no terminal event arrives */
let wsCloseTimeout = null;

/** Cached client session token (valid ~24 h) */
let cachedSessionToken = null;
let tokenExpiresAt = null;

// --- Token management ---

/**
 * Get or generate a session token for CaptureClient.
 * Caches the token until 5 minutes before expiry.
 */
async function getSessionToken(videodbService, apiKey) {
  if (cachedSessionToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    console.log('Using cached session token (expires in', Math.round((tokenExpiresAt - Date.now()) / 1000 / 60), 'minutes)');
    return cachedSessionToken;
  }

  if (!apiKey) {
    console.warn('No API key available. Please register first.');
    return null;
  }

  try {
    console.log('Generating session token via VideoDB SDK...');
    const tokenData = await videodbService.generateSessionToken(apiKey);
    if (tokenData && tokenData.sessionToken) {
      cachedSessionToken = tokenData.sessionToken;
      const expiresInMs = (tokenData.expiresIn || 3600) * 1000;
      tokenExpiresAt = Date.now() + expiresInMs - (5 * 60 * 1000); // 5 min buffer
      return cachedSessionToken;
    }
  } catch (error) {
    console.error('Error generating session token:', error);
  }
  return null;
}

/**
 * Clear cached session token (e.g. on logout).
 */
function clearSessionToken() {
  cachedSessionToken = null;
  tokenExpiresAt = null;
}

// --- Background indexing ---

/**
 * Run indexing (transcript + subtitles) for an exported video.
 * Updates the recording row in DB as it progresses.
 */
async function processIndexingBackground(recordingId, videoId, apiKey) {
  try {
    updateRecording(recordingId, { insights_status: 'processing' });
    console.log(`[Index] Starting indexing for recording ${recordingId}`);

    const result = await indexVideo(videoId, apiKey);

    if (result) {
      const updates = { insights_status: 'ready' };
      if (result.transcript) {
        updates.insights = JSON.stringify({ transcript: result.transcript });
      }
      if (result.subtitleUrl) {
        updates.stream_url = result.subtitleUrl;
        const { getRecordingById } = require('../db/database');
        const recording = getRecordingById(recordingId);
        if (recording && recording.player_url && recording.player_url.includes('url=')) {
          updates.player_url = recording.player_url.replace(/url=[^&]+/, `url=${result.subtitleUrl}`);
        } else {
          updates.player_url = result.subtitleUrl;
        }
      }
      updateRecording(recordingId, updates);
      console.log(`[Index] Indexed video ${videoId} successfully`);
    } else {
      updateRecording(recordingId, { insights_status: 'failed' });
      console.warn(`[Index] Failed to index video ${videoId}`);
    }
  } catch (err) {
    console.error(`[Index] Error processing:`, err);
    try {
      updateRecording(recordingId, { insights_status: 'failed' });
    } catch (_) { /* ignore DB errors during error handling */ }
  }
}

// --- Polling fallback ---

/**
 * Poll a capture session's status until exported or failed.
 * Used when the WebSocket misses the terminal event.
 */
async function syncCaptureSession(sessionId, apiKey, videodbService) {
  const POLL_INTERVAL = 10_000;
  const MAX_ATTEMPTS = 60; // ~10 min max
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const session = await videodbService.getCaptureSession(apiKey, sessionId);

      if (session.exportedVideoId) {
        console.log(`[Sync] Exported video received: ${session.exportedVideoId}`);
        const recording = findRecordingBySessionId(sessionId);
        if (recording) {
          updateRecording(recording.id, {
            video_id: session.exportedVideoId,
            stream_url: session.streamUrl,
            player_url: session.playerUrl,
            insights_status: 'pending',
          });
          processIndexingBackground(recording.id, session.exportedVideoId, apiKey);
        }
        return;
      }

      if (session.status === 'failed') {
        console.log(`[Sync] Session failed: ${sessionId}`);
        const recording = findRecordingBySessionId(sessionId);
        if (recording) updateRecording(recording.id, { insights_status: 'failed' });
        return;
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    } catch (err) {
      console.error(`[Sync] Error:`, err.message);
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
  }
  console.warn(`[Sync] Gave up polling session ${sessionId} after ${MAX_ATTEMPTS} attempts`);
}

/**
 * On startup, check for recordings that started but never got an export event.
 */
async function syncOrphanedSessions(apiKey, videodbService) {
  if (!apiKey) return;

  const orphaned = getOrphanedRecordings();
  if (orphaned.length === 0) return;

  console.log(`[Sync] Found ${orphaned.length} orphaned recording(s), syncing...`);
  for (const rec of orphaned) {
    await syncCaptureSession(rec.session_id, apiKey, videodbService);
  }
}

// --- WebSocket event listener ---

/**
 * Start background listener on a WebSocket connection for capture session events.
 * Handles the exported/stopped/failed events, updates DB, triggers indexing.
 * Falls back to polling if the WS closes without a terminal event.
 */
function startWebSocketListener(ws, captureSessionId, apiKey, videodbService) {
  (async () => {
    let receivedTerminalEvent = false;
    try {
      console.log('[WS] Listening for capture session events...');
      for await (const msg of ws.receive()) {
        const channel = msg.channel || msg.type || 'unknown';
        const status = msg.data?.status || msg.status || '';
        console.log(`[WS] ${channel}: ${status}`);

        if (channel === 'capture_session') {
          const data = msg.data || {};
          const videoId = data.exported_video_id;
          const streamUrl = data.stream_url;
          const playerUrl = data.player_url;
          const sessionId = msg.capture_session_id;

          if (videoId) {
            const recording = findRecordingBySessionId(sessionId);
            if (recording) {
              updateRecording(recording.id, {
                video_id: videoId,
                stream_url: streamUrl,
                player_url: playerUrl,
                insights_status: 'pending',
              });
              console.log(`[WS] Updated recording: ${videoId}`);
              processIndexingBackground(recording.id, videoId, apiKey);
            }
          }
        }

        if (channel === 'capture_session' && (status === 'stopped' || status === 'exported' || status === 'failed')) {
          receivedTerminalEvent = true;
          if (wsCloseTimeout) { clearTimeout(wsCloseTimeout); wsCloseTimeout = null; }
          console.log(`[WS] Terminal event (${status}), closing WebSocket...`);
          await ws.close();
          if (wsConnection === ws) wsConnection = null;
          break;
        }
      }
    } catch (err) {
      console.error('[WS] Listener error:', err.message);
    }

    // Sync recording if video data is still missing
    try {
      const rec = findRecordingBySessionId(captureSessionId);
      if (!receivedTerminalEvent || (rec && !rec.video_id)) {
        await syncCaptureSession(captureSessionId, apiKey, videodbService);
      }
    } catch (fallbackErr) {
      console.error('[Sync] Error:', fallbackErr.message);
    }
  })();
}

// --- CaptureClient lifecycle ---

function getCaptureClient() {
  return captureClient;
}

function setCaptureClient(client) {
  captureClient = client;
}

function getWsConnection() {
  return wsConnection;
}

function setWsConnection(ws) {
  wsConnection = ws;
}

function getWsCloseTimeout() {
  return wsCloseTimeout;
}

function setWsCloseTimeout(timeout) {
  wsCloseTimeout = timeout;
}

/**
 * Graceful shutdown of capture client and WebSocket.
 */
async function shutdownSession() {
  if (captureClient) {
    try {
      await captureClient.shutdown();
      console.log('CaptureClient shutdown complete');
    } catch (error) {
      console.error('Error during SDK shutdown:', error);
    }
    captureClient = null;
  }

  if (wsCloseTimeout) {
    clearTimeout(wsCloseTimeout);
    wsCloseTimeout = null;
  }

  if (wsConnection) {
    try {
      await wsConnection.close();
      console.log('[WS] WebSocket closed');
    } catch (_) { /* ignore */ }
    wsConnection = null;
  }
}

module.exports = {
  // Token
  getSessionToken,
  clearSessionToken,
  // Indexing
  processIndexingBackground,
  // Sync / polling
  syncCaptureSession,
  syncOrphanedSessions,
  // WebSocket
  startWebSocketListener,
  // CaptureClient accessors
  getCaptureClient,
  setCaptureClient,
  getWsConnection,
  setWsConnection,
  getWsCloseTimeout,
  setWsCloseTimeout,
  // Lifecycle
  shutdownSession,
};
