'use strict';

const { connect } = require('videodb');

// Subtitle style matching the Python LOOM_SUBTITLE_STYLE config
const SUBTITLE_STYLE = {
  fontSize: 14,
  fontName: 'Roboto',
  bold: false,
  fontColor: '#FFFFFF',
  backgroundColor: '#000000',
  backgroundAlpha: 0.5,
  alignment: 'bottom_center',
  marginBottom: 30,
  borderStyle: 'opaque_box',
  outline: 2,
  shadow: 0,
};

/**
 * Index a video: generate spoken-word index, transcript, and subtitles.
 * Runs as a background task after capture session export.
 *
 * @param {string} videoId - VideoDB video ID (m-xxx)
 * @param {string} apiKey - User's VideoDB API key
 * @param {string} [baseUrl] - Optional API base URL override
 * @returns {Promise<{transcript: string, subtitleUrl: string}|null>}
 */
async function indexVideo(videoId, apiKey, baseUrl) {
  try {
    const config = { apiKey };
    if (baseUrl) config.baseUrl = baseUrl;
    const conn = connect(config);
    const coll = await conn.getCollection();
    const video = await coll.getVideo(videoId);

    if (!video) {
      console.error(`[Insights] Video not found: ${videoId}`);
      return null;
    }

    // Step 1: Index spoken words for search
    console.log(`[Insights] Indexing spoken words for ${videoId}...`);
    try {
      await video.indexSpokenWords();
    } catch (err) {
      // No speech detected — recording is fine, just no transcript to generate
      console.log(`[Insights] No spoken words found for ${videoId}, skipping transcript`);
      return { transcript: null, subtitleUrl: null };
    }

    // Step 2: Get transcript text
    console.log(`[Insights] Getting transcript for ${videoId}...`);
    const transcript = await video.getTranscriptText();

    // Step 3: Generate subtitled stream
    console.log(`[Insights] Adding subtitles for ${videoId}...`);
    const subtitleUrl = await video.addSubtitle(SUBTITLE_STYLE);

    console.log(`[Insights] Indexing complete for ${videoId}`);
    return { transcript, subtitleUrl };
  } catch (err) {
    console.error(`[Insights] Error indexing video ${videoId}:`, err.message);
    return null;
  }
}

module.exports = { indexVideo, SUBTITLE_STYLE };
