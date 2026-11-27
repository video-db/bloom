const { createHash } = require('node:crypto');
const { ServiceError, request } = require('./errors');
const { createOperationJournal } = require('./journal');
const { createOperations } = require('./operations');
const { createLibrary } = require('./library');
const { createCollectionActions } = require('./collection-actions');
const { createExplore } = require('./explore');
const { createUnderstand } = require('./understand');
const { createEditing } = require('./editing');
const { createSessions } = require('./sessions');

const DEV_API = 'https://api.dev.videodb.io';
const PROD_API = 'https://api.videodb.io';
const SDK_BRANCH = 'release-0.3.3';
const COLLECTION_NAME = 'Bloom Recordings';

// Main-process boundary only. The SDK and credential store are injected for offline verification.
function createVideoDBService({
  connect,
  CaptureClient,
  editor, // the SDK's editor classes, for making versions
  credentials,
  journal = createOperationJournal(),
  apiUrl = DEV_API,
  timeoutMs = 30000,
}) {
  if (![DEV_API, PROD_API].includes(apiUrl))
    throw new ServiceError(
      'invalid-environment',
      'Choose the VideoDB development or production environment.',
    );
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new ServiceError(
      'invalid-input',
      'The request deadline must be positive.',
    );
  let current = null;
  let generation = 0;
  let authenticating = false;

  const call = (work, mutation = false) =>
    request(work, { timeoutMs, mutation });
  function account() {
    if (!current)
      throw new ServiceError(
        'signed-out',
        'Connect your VideoDB account first.',
      );
    return current;
  }
  function assertCurrent(scope) {
    if (scope !== current)
      throw new ServiceError(
        'account-changed',
        'Your account changed. Open the recording again.',
      );
  }
  // A fingerprint isolates accounts as well as environments; it is never a credential. A key is
  // known by itself, so a rotated key is a new scope. A browser sign-in is known by its VideoDB
  // user, so the next token (every 30 days) keeps the same recordings and recorder owner.
  const scopeFor = (saved) =>
    createHash('sha256')
      .update(
        saved.kind === 'token'
          ? `${apiUrl}\0user:${saved.userId}`
          : `${apiUrl}\0${saved.secret}`,
      )
      .digest('hex');
  const expired = (saved) =>
    Number.isFinite(saved.expiresAt) && Date.now() >= saved.expiresAt;

  async function connectWith(saved, { save = true } = {}) {
    if (authenticating || operations.busy())
      throw new ServiceError(
        'busy',
        'Finish or reconcile pending work before changing accounts.',
      );
    const attempt = ++generation;
    authenticating = true;
    try {
      const conn = await call(() =>
        connect({ apiKey: saved.secret, baseUrl: apiUrl }),
      );
      const collections = await call(() => conn.getCollections());
      if (!Array.isArray(collections))
        throw new ServiceError(
          'invalid-response',
          'VideoDB returned an unreadable library. Try again.',
        );
      const matches = collections.filter(
        (item) => item?.name === COLLECTION_NAME,
      );
      if (matches.length > 1)
        throw new ServiceError(
          'collection-ambiguous',
          'More than one Bloom collection exists. The intended collection must be identified before continuing.',
        );
      if (attempt !== generation)
        throw new ServiceError(
          'account-changed',
          'Sign-in was cancelled. Try again.',
        );
      const id = scopeFor(saved);
      if (save) {
        if (saved.kind === 'token')
          credentials?.writeToken({
            token: saved.secret,
            userId: saved.userId,
            expiresAt: saved.expiresAt ?? null,
          });
        else credentials?.write(saved.secret);
      }
      current = { id, conn, collection: matches[0] || null };
      operations.restore(current);
      return {
        scopeId: id,
        collectionId: current.collection?.id || null,
        apiUrl,
      };
    } finally {
      authenticating = false;
    }
  }

  async function read(scope, work) {
    assertCurrent(scope);
    const result = await call(work);
    assertCurrent(scope);
    return result;
  }
  const operations = createOperations({ call, journal, assertCurrent });
  const { mutate } = operations;

  return {
    apiUrl,
    cachedIdentity() {
      const saved = credentials?.readCredential
        ? credentials.readCredential()
        : credentials?.read() && { kind: 'key', secret: credentials.read() };
      return saved ? { scopeId: scopeFor(saved) } : null;
    },
    ...createLibrary({ account, read, assertCurrent, operations, journal }),
    ...createSessions({ account, read, mutate, operations }),
    ...createExplore({ account, read }),
    ...createCollectionActions({ account, read, operations }),
    ...createUnderstand({ account, read }),
    ...createEditing({ account, assertCurrent, editor }),
    async signIn(apiKey) {
      if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096)
        throw new ServiceError('invalid-input', 'Enter a VideoDB API key.');
      return connectWith({ kind: 'key', secret: apiKey.trim() });
    },
    // A browser sign-in (Sign in with VideoDB): the console's token and its VideoDB user.
    async signInWithToken({ token, userId, expiresAt = null } = {}) {
      if (
        typeof token !== 'string' ||
        !token ||
        token.length > 4096 ||
        typeof userId !== 'string' ||
        !userId
      )
        throw new ServiceError('invalid-input', 'Sign in with VideoDB again.');
      return connectWith({ kind: 'token', secret: token, userId, expiresAt });
    },
    async restore() {
      const saved = credentials?.readCredential
        ? credentials.readCredential()
        : credentials?.read() && { kind: 'key', secret: credentials.read() };
      if (!saved) return null;
      // The console's token has no refresh: once it runs out, the person signs in again.
      if (saved.kind === 'token' && expired(saved))
        throw new ServiceError(
          'authentication',
          'Your sign-in ran out. Sign in with VideoDB again.',
        );
      return connectWith(saved, { save: false });
    },
    signInMethod() {
      try {
        return credentials?.readCredential?.()?.kind || null;
      } catch {
        return null;
      }
    },
    signOut() {
      if (operations.busy())
        throw new ServiceError(
          'busy',
          'Finish or reconcile pending work before signing out.',
        );
      credentials?.clear();
      generation += 1;
      current = null;
    },
    async ensureCollection() {
      const scope = account();
      if (scope.collection) return scope.collection.id;
      return mutate(scope, 'collection', { kind: 'collection' }, async () => {
        const coll = await scope.conn.createCollection(
          COLLECTION_NAME,
          'Recordings created with Bloom',
          false,
        );
        assertCurrent(scope);
        scope.collection = coll;
        return coll.id;
      });
    },
    // A fresh recorder token, bound to the Bloom collection (or the one a recording was
    // authorised for), for the recorder's own use: it sends the recording with it. Never cached.
    async recorderAuthorization({ owner, collectionId } = {}) {
      const scope = account();
      if (typeof owner !== 'string' || !owner)
        throw new ServiceError(
          'signed-out',
          'Connect your VideoDB account first.',
        );
      const target = collectionId || (await this.ensureCollection());
      const issued = await read(scope, () =>
        scope.conn.generateRecorderToken({
          collectionId: target,
          userId: owner,
          expiresIn: 3600,
        }),
      );
      if (
        typeof issued?.token !== 'string' ||
        !issued.token ||
        typeof issued.collectionId !== 'string'
      )
        throw new ServiceError(
          'authentication',
          'A recorder token could not be issued. Reconnect and try again.',
        );
      return { token: issued.token, collectionId: issued.collectionId };
    },
    pendingOperations() {
      return journal
        .list(account().id)
        .filter((item) => item.state === 'pending')
        .map(({ key, kind, title }) => ({
          key,
          kind,
          ...(title ? { title } : {}),
        }));
    },
    async reconcileCollection() {
      const scope = account();
      const collections = await read(scope, () => scope.conn.getCollections());
      if (!Array.isArray(collections))
        throw new ServiceError(
          'invalid-response',
          'VideoDB returned an unreadable library. Try again.',
        );
      const matches = collections.filter(
        (item) => item?.name === COLLECTION_NAME,
      );
      if (matches.length !== 1)
        return { reconciliationNeeded: true, collectionId: null };
      scope.collection = matches[0];
      operations.confirm(scope, 'collection');
      return { reconciliationNeeded: false, collectionId: scope.collection.id };
    },
    captureCapabilities() {
      const prototype = CaptureClient?.prototype;
      const missing = [
        'getCapabilities',
        'startRecording',
        'stopRecording',
        'listRecordings',
        'relayRecording',
        'waitForProcessing',
        'getWindows',
      ].filter((method) => typeof prototype?.[method] !== 'function');
      return {
        supported: missing.length === 0,
        missing,
        reason: 'Recording needs an SDK with managed recording.',
      };
    },
  };
}

module.exports = { createVideoDBService, DEV_API, PROD_API, SDK_BRANCH };
