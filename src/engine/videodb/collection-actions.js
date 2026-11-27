const { ServiceError } = require('./errors');
const { requireId } = require('./library');

function createCollectionActions({ account, read, operations }) {
  function target(id) {
    requireId(id);
    const scope = account();
    // Recording destination discovery is name-based, including after a restart.
    if (id === scope.collection?.id)
      throw new ServiceError(
        'protected',
        'Bloom Recordings is the recording destination and cannot be renamed or deleted.',
      );
    return scope;
  }
  return {
    async renameCollection(id, title) {
      const scope = target(id);
      if (
        typeof title !== 'string' ||
        !title.trim() ||
        title.length > 120 ||
        title.trim() === 'Bloom Recordings'
      )
        throw new ServiceError(
          'invalid-input',
          'Use a collection name of 1–120 characters other than Bloom Recordings.',
        );
      const coll = await read(scope, () => scope.conn.getCollection(id));
      await operations.mutate(
        scope,
        `collection:${id}`,
        { kind: 'rename', title: title.trim() },
        () => scope.conn.updateCollection(id, title.trim(), coll.description),
      );
    },
    async deleteCollection(id) {
      const scope = target(id);
      const coll = await read(scope, () => scope.conn.getCollection(id));
      await operations.mutate(
        scope,
        `collection:${id}`,
        { kind: 'delete' },
        () => coll.delete(),
      );
    },
    async reconcileCollectionAction(id) {
      const scope = target(id);
      const key = `collection:${id}`;
      const entry = operations.getUncertain(scope, key);
      if (!entry) return { reconciliationNeeded: false };
      let coll;
      try {
        coll = await read(scope, () => scope.conn.getCollection(id));
      } catch (error) {
        if (error.code !== 'not-found') throw error;
      }
      const confirmed =
        (entry.kind === 'delete' && !coll) ||
        (entry.kind === 'rename' && coll?.name === entry.title);
      if (confirmed) operations.confirm(scope, key);
      return { reconciliationNeeded: !confirmed };
    },
  };
}

module.exports = { createCollectionActions };
