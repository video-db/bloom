const { ServiceError } = require('./errors');

function createSessions({ account, read, mutate, operations }) {
  async function ownedSession(scope, id) {
    if (!scope.collection || typeof id !== 'string' || !id)
      throw new ServiceError(
        'not-found',
        'The recording session is not available for this account.',
      );
    const session = await read(scope, () =>
      scope.collection.getCaptureSession(id),
    );
    if (!session.endUserId || session.collectionId !== scope.collection.id)
      throw new ServiceError(
        'forbidden',
        'The recording session owner could not be verified.',
      );
    return session;
  }
  return {
    async createSession(operationId) {
      const scope = account();
      if (!scope.collection)
        throw new ServiceError(
          'collection-missing',
          'Create the Bloom collection first.',
        );
      return mutate(
        scope,
        'session',
        { kind: 'session', operationId },
        async () => {
          const session = await scope.collection.createCaptureSession({
            endUserId: `bloom-${scope.id.slice(0, 24)}`,
            metadata: { app: 'bloom', operationId },
          });
          return { id: session.id, endUserId: session.endUserId };
        },
      );
    },
    async reconcileSession() {
      const scope = account();
      const entry = operations.getUncertain(scope, 'session');
      if (!entry) return { reconciliationNeeded: false };
      if (!scope.collection || !entry.operationId)
        return { reconciliationNeeded: true };
      const sessions = await read(scope, () =>
        scope.collection.listCaptureSessions(),
      );
      const found = sessions.filter(
        (session) => session.metadata?.operationId === entry.operationId,
      );
      if (found.length !== 1) return { reconciliationNeeded: true };
      operations.confirm(scope, 'session');
      return { reconciliationNeeded: false };
    },
    async ownsSession(id) {
      await ownedSession(account(), id);
      return true;
    },
    async recorderToken({ sessionId } = {}) {
      const scope = account();
      const session = sessionId ? await ownedSession(scope, sessionId) : null;
      const token = await read(scope, () =>
        scope.conn.generateClientToken(3600, session?.endUserId),
      );
      if (typeof token !== 'string' || !token)
        throw new ServiceError(
          'authentication',
          'A recorder token could not be issued. Reconnect and try again.',
        );
      return token;
    },
  };
}

module.exports = { createSessions };
