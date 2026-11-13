const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

function createDownloads({ engine, dialog }) {
  const active = new Set();
  return async function download(from, id) {
    if (typeof id !== 'string' || active.has(id)) return;
    active.add(id);
    let temporary;
    try {
      const choice = await dialog.showSaveDialog(from, {
        title: 'Download recording',
        defaultPath: 'recording.mp4',
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
      });
      if (choice.canceled || !choice.filePath) return;
      const result = await engine.prepareDownload(id);
      // A signed destination needs no API credentials and must not redirect them anywhere.
      const response = await fetch(result.url, {
        redirect: 'error',
        signal: AbortSignal.timeout(1200000),
      });
      if (!response.ok || !response.body) throw new Error('download failed');
      temporary = `${choice.filePath}.${randomUUID()}.part`;
      await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      await fs.promises.rename(temporary, choice.filePath);
      temporary = null;
      engine.notice?.('Recording downloaded.');
    } catch {
      engine.notice?.(
        'The download could not finish. Check disk space and your connection, then try again.',
      );
    } finally {
      if (temporary)
        await fs.promises.rm(temporary, { force: true }).catch(() => {});
      active.delete(id);
    }
  };
}

module.exports = { createDownloads };
