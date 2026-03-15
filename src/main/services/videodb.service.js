'use strict';

const { connect, AuthenticationError } = require('videodb');

/**
 * VideoDB service layer — wraps the Node SDK for server-side operations.
 * Maintains a connection cache keyed by API key.
 */
class VideoDBService {
  constructor(options = {}) {
    this._connections = new Map();
    this._baseUrl = options.baseUrl || null; // optional override for dev
  }

  /**
   * Get or create a cached Connection for the given API key.
   */
  _getConnection(apiKey) {
    if (!apiKey) throw new Error('API key is required');
    if (this._connections.has(apiKey)) {
      return this._connections.get(apiKey);
    }
    const config = { apiKey };
    if (this._baseUrl) config.baseUrl = this._baseUrl;
    const conn = connect(config);
    this._connections.set(apiKey, conn);
    return conn;
  }

  /**
   * Validate an API key by attempting to fetch the default collection.
   * @param {string} apiKey
   * @returns {Promise<boolean>}
   */
  async verifyApiKey(apiKey) {
    try {
      // Don't use cached connection — create fresh to truly verify
      const config = { apiKey };
      if (this._baseUrl) config.baseUrl = this._baseUrl;
      const conn = connect(config);
      await conn.getCollection();
      // Cache the verified connection
      this._connections.set(apiKey, conn);
      return true;
    } catch (err) {
      if (err instanceof AuthenticationError || err.name === 'AuthenticationError') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Generate a client session token for capture operations.
   * @param {string} apiKey - User's API key
   * @param {number} [expiresIn=86400] - Token lifetime in seconds
   * @returns {Promise<{sessionToken: string, expiresIn: number, expiresAt: number}>}
   */
  async generateSessionToken(apiKey, expiresIn = 86400) {
    const conn = this._getConnection(apiKey);
    const token = await conn.generateClientToken(expiresIn);
    return {
      sessionToken: token,
      expiresIn,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    };
  }

  /**
   * Connect a WebSocket for real-time event streaming.
   * @param {string} apiKey
   * @param {string} [collectionId='default']
   * @returns {Promise<import('videodb').WebSocketConnection>}
   */
  async connectWebsocket(apiKey, collectionId = 'default') {
    const conn = this._getConnection(apiKey);
    const ws = await conn.connectWebsocket(collectionId);
    await ws.connect();
    return ws;
  }

  /**
   * Create a capture session on VideoDB.
   * @param {string} apiKey
   * @param {object} options
   * @param {string} options.endUserId
   * @param {string} options.wsConnectionId
   * @param {object} [options.metadata]
   * @returns {Promise<{sessionId: string, collectionId: string, endUserId: string, status: string}>}
   */
  async createCaptureSession(apiKey, { endUserId, wsConnectionId, metadata }) {
    const conn = this._getConnection(apiKey);
    const session = await conn.createCaptureSession({
      endUserId,
      wsConnectionId,
      metadata,
    });
    return {
      sessionId: session.id,
      collectionId: session.collectionId,
      endUserId: session.endUserId,
      status: session.status,
    };
  }

  /**
   * Fetch a capture session's current status from VideoDB.
   * Used as fallback when WebSocket misses events.
   * @param {string} apiKey
   * @param {string} sessionId - Capture session ID (cap-xxx)
   * @returns {Promise<{status: string, exportedVideoId: string|null}>}
   */
  async getCaptureSession(apiKey, sessionId) {
    const conn = this._getConnection(apiKey);
    const coll = await conn.getCollection();
    const session = await coll.getCaptureSession(sessionId);
    return {
      status: session.status,
      exportedVideoId: session.exportedVideoId || null,
      streamUrl: session.streamUrl || null,
      playerUrl: session.playerUrl || null,
    };
  }

  /**
   * Fetch a fresh share URL for a video by calling the API.
   * @param {string} apiKey
   * @param {string} videoId
   * @returns {Promise<{streamUrl: string|null, playerUrl: string|null}>}
   */
  async getShareUrl(apiKey, videoId) {
    const conn = this._getConnection(apiKey);
    const coll = await conn.getCollection();
    const video = await coll.getVideo(videoId);
    return {
      streamUrl: video.streamUrl || null,
      playerUrl: video.playerUrl || null,
    };
  }

  /**
   * Clear all cached connections (e.g. on logout).
   */
  clearAll() {
    this._connections.clear();
  }
}

module.exports = { VideoDBService };
