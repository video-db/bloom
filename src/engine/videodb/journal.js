const fs = require('node:fs');
const { atomicWrite } = require('./files');
const { ServiceError } = require('./errors');

const kinds = new Set([
  'rename',
  'delete',
  'collection',
  'index',
  'download',
  'session',
]);
function valid(item) {
  return (
    item &&
    typeof item === 'object' &&
    /^[a-f0-9]{64}$/.test(item.scopeId) &&
    typeof item.key === 'string' &&
    item.key.length <= 200 &&
    kinds.has(item.kind) &&
    ['pending', 'confirmed'].includes(item.state) &&
    (item.title === undefined ||
      (typeof item.title === 'string' && item.title.length <= 180)) &&
    (item.operationId === undefined ||
      (typeof item.operationId === 'string' &&
        item.operationId.length <= 180)) &&
    Object.keys(item).every((key) =>
      ['scopeId', 'key', 'kind', 'state', 'title', 'operationId'].includes(key),
    )
  );
}

// Pending mutations survive a restart; media recovery remains owned by the native journal.
function createOperationJournal(file) {
  let entries = [];
  if (file && fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.entries) ||
        !saved.entries.every(valid)
      )
        throw new Error();
      entries = saved.entries;
    } catch {
      throw new ServiceError(
        'journal-corrupt',
        'Pending work could not be read. Its file has been retained; reconnecting must not discard it.',
      );
    }
  }
  function persist(next) {
    try {
      if (file)
        atomicWrite(file, JSON.stringify({ version: 1, entries: next }));
      entries = next;
    } catch {
      throw new ServiceError(
        'storage',
        'Pending work could not be saved. Check disk space and try again.',
      );
    }
  }
  return {
    list(scopeId) {
      return entries
        .filter((item) => item.scopeId === scopeId)
        .map((item) => ({ ...item }));
    },
    put(item) {
      if (!valid(item))
        throw new ServiceError(
          'invalid-input',
          'Pending work has an invalid format.',
        );
      persist([
        ...entries.filter(
          (entry) => entry.scopeId !== item.scopeId || entry.key !== item.key,
        ),
        { ...item },
      ]);
    },
    remove(scopeId, key) {
      persist(
        entries.filter(
          (entry) => entry.scopeId !== scopeId || entry.key !== key,
        ),
      );
    },
  };
}

module.exports = { createOperationJournal };
