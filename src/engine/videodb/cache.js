const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { atomicWrite } = require('./files');
const { ServiceError } = require('./errors');

const fields = [
  'id',
  'videoId',
  'sessionId',
  'recordingId',
  'title',
  'duration',
  'createdAt',
  'status',
  'jobStage',
  'marks',
  'transcript',
  'transcriptStatus',
  'paragraphs',
  'summary',
  'requestedTitle',
  'pendingOperation',
  'paused',
];

function createRecordingCache(file) {
  let scopes = {};
  let warning = null;
  if (file && fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        saved.version !== 1 ||
        !saved.scopes ||
        typeof saved.scopes !== 'object' ||
        Array.isArray(saved.scopes)
      )
        throw new Error();
      for (const [id, records] of Object.entries(saved.scopes)) {
        if (
          !/^[a-f0-9]{64}$/.test(id) ||
          !Array.isArray(records) ||
          !records.every(
            (r) =>
              r &&
              typeof r.id === 'string' &&
              typeof r.title === 'string' &&
              Array.isArray(r.marks),
          )
        )
          throw new Error();
      }
      scopes = saved.scopes;
    } catch {
      // Preserve local-only marks and metadata for inspection rather than overwriting corruption.
      fs.copyFileSync(file, `${file}.corrupt-${randomUUID()}`);
      warning =
        'The library cache was damaged. A copy was retained; cloud recordings and native pending jobs will be reloaded.';
    }
  }
  return {
    warning,
    load(id) {
      return structuredClone(scopes[id] || []);
    },
    save(id, records) {
      if (!/^[a-f0-9]{64}$/.test(id))
        throw new ServiceError('storage', 'The account scope is unavailable.');
      const projected = records.map((r) =>
        Object.fromEntries(
          fields
            .filter((key) => r[key] !== undefined)
            .map((key) => [key, r[key]]),
        ),
      );
      const next = { ...scopes, [id]: projected };
      try {
        if (file)
          atomicWrite(file, JSON.stringify({ version: 1, scopes: next }));
      } catch {
        throw new ServiceError(
          'storage',
          'The library could not be saved. Check disk space and try again.',
        );
      }
      scopes = next;
    },
  };
}

module.exports = { createRecordingCache };
