const { ServiceError } = require('./errors');

// Owns in-flight commands; persisted pending evidence belongs to the journal.
function createOperations({ call, journal, assertCurrent }) {
  const mutations = new Map();
  const uncertain = new Map();
  function mutate(scope, key, intent, operation) {
    assertCurrent(scope);
    const scopedKey = `${scope.id}:${key}`;
    if (uncertain.has(scopedKey))
      return Promise.reject(
        new ServiceError(
          'reconciliation-needed',
          'Check the previous operation before trying again.',
          { uncertain: true },
        ),
      );
    if (mutations.has(scopedKey))
      return Promise.reject(
        new ServiceError(
          'busy',
          'This recording already has an operation in progress.',
        ),
      );
    const entry = { scopeId: scope.id, key, state: 'pending', ...intent };
    journal.put(entry);
    const pending = (async () => {
      try {
        const result = await call(operation, true);
        assertCurrent(scope);
        if (intent.kind === 'index')
          journal.put({ ...entry, state: 'confirmed' });
        else journal.remove(scope.id, key);
        return result;
      } catch (error) {
        if (error.uncertain || error.code === 'storage')
          uncertain.set(scopedKey, entry);
        else journal.remove(scope.id, key);
        throw error;
      } finally {
        mutations.delete(scopedKey);
      }
    })();
    mutations.set(scopedKey, pending);
    return pending;
  }

  return {
    mutate,
    busy: () => mutations.size > 0 || uncertain.size > 0,
    getUncertain: (scope, key) => uncertain.get(`${scope.id}:${key}`),
    restore(scope) {
      for (const entry of journal
        .list(scope.id)
        .filter((item) => item.state === 'pending'))
        uncertain.set(`${scope.id}:${entry.key}`, entry);
    },
    confirm(scope, key) {
      journal.remove(scope.id, key);
      uncertain.delete(`${scope.id}:${key}`);
    },
    confirmIndex(scope, entry) {
      journal.put({ ...entry, state: 'confirmed' });
      uncertain.delete(`${scope.id}:${entry.key}`);
    },
  };
}

module.exports = { createOperations };
