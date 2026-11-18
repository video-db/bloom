const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const FormData = require('form-data');
const { ServiceError, request, safeError } = require('./errors');
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
// The SDK gives every request 60 seconds and sends a file as one request, which at 10 Mbit/s
// caps a recording near 70 MB. Bloom sends the file itself with no time or size limit; only
// a send that has stopped moving for this long is given up, to be tried again.
const STALLED_MS = 2 * 60 * 1000;
// VideoDB makes the video from the file before answering; for a long recording that can
// take well past the SDK's own eight-minute wait, after which the file would be sent again.
const REGISTER_MS = 60 * 60 * 1000;

// Main-process boundary only. The SDK and credential store are injected for offline verification.
function createVideoDBService({
  connect,
  CaptureClient,
  editor, // the SDK's editor classes, for making versions
  credentials,
  journal = createOperationJournal(),
  apiUrl = DEV_API,
  timeoutMs = 30000,
  stalledMs = STALLED_MS, // tests shorten it
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
      const key = credentials?.read();
      return key
        ? {
            scopeId: createHash('sha256')
              .update(`${apiUrl}\0${key}`)
              .digest('hex'),
          }
        : null;
    },
    ...createLibrary({ account, read, assertCurrent, operations, journal }),
    ...createSessions({ account, read, mutate, operations }),
    ...createExplore({ account, read }),
    ...createCollectionActions({ account, read, operations }),
    ...createUnderstand({ account, read }),
    ...createEditing({ account, assertCurrent, editor }),
    async signIn(apiKey) {
      if (authenticating || operations.busy())
        throw new ServiceError(
          'busy',
          'Finish or reconcile pending work before changing accounts.',
        );
      if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096)
        throw new ServiceError('invalid-input', 'Enter a VideoDB API key.');
      const attempt = ++generation;
      authenticating = true;
      try {
        const conn = await call(() =>
          connect({ apiKey: apiKey.trim(), baseUrl: apiUrl }),
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
        // A fingerprint isolates rotated keys as well as environments; it is never a credential.
        const id = createHash('sha256')
          .update(`${apiUrl}\0${apiKey.trim()}`)
          .digest('hex');
        credentials?.write(apiKey.trim());
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
    },
    async restore() {
      const key = credentials?.read();
      return key ? this.signIn(key) : null;
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
    // Send a finished recording file to the Bloom collection: the file to VideoDB's upload
    // address, then the video made from it. onProgress hears the share of the file sent.
    async uploadRecording({ path: filePath, title, onProgress = () => {} }) {
      const scope = account();
      await this.ensureCollection();
      assertCurrent(scope);
      let size;
      try {
        size = (await fs.promises.stat(filePath)).size;
      } catch {
        throw new ServiceError(
          'not-found',
          'This recording can’t be processed.',
        );
      }
      const http = scope.conn.vhttp;
      const cancel = new AbortController();
      let moved = Date.now();
      const watch = setInterval(
        () => {
          if (Date.now() - moved > stalledMs) cancel.abort();
        },
        Math.min(15000, stalledMs),
      );
      try {
        const target = await call(() =>
          http.get(['collection', scope.collection.id, 'upload_url']),
        );
        const url = target?.data?.uploadUrl;
        if (typeof url !== 'string' || !/^https:\/\//.test(url))
          throw new ServiceError(
            'invalid-response',
            'VideoDB did not accept the recording.',
          );
        // Progress is what has been read from the file. With redirects off the request
        // takes it only as fast as the connection does; following redirects would hold the
        // whole file in memory and read it at once.
        let sent = 0;
        const file = fs.createReadStream(filePath);
        file.on('data', (chunk) => {
          sent += chunk.length;
          moved = Date.now();
          onProgress(size ? sent / size : 1);
        });
        const form = new FormData();
        form.append('file', file, {
          knownLength: size,
          filename: path.basename(filePath),
        });
        moved = Date.now();
        try {
          await http.post([url], form, {
            headers: {
              ...form.getHeaders(),
              'Content-Length': form.getLengthSync(),
            },
            timeout: 0,
            maxRedirects: 0,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            signal: cancel.signal,
          });
        } catch (error) {
          throw safeError(error);
        }
        clearInterval(watch);
        assertCurrent(scope);
        // The same call as the SDK's uploadURL, waiting up to an hour for the video.
        const made = await request(
          () =>
            http.post(
              ['collection', scope.collection.id, 'upload'],
              { url, ...(title ? { name: title } : {}) },
              undefined,
              { maxPollTime: REGISTER_MS },
            ),
          { timeoutMs: REGISTER_MS + 60 * 1000, mutation: true },
        );
        const video = made?.data;
        assertCurrent(scope);
        if (typeof video?.id !== 'string')
          throw new ServiceError(
            'invalid-response',
            'VideoDB did not confirm the recording.',
          );
        return { id: video.id };
      } finally {
        clearInterval(watch);
      }
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
        'startLocalRecording',
        'stopLocalRecording',
        'getWindows',
      ].filter((method) => typeof prototype?.[method] !== 'function');
      return {
        supported: missing.length === 0,
        missing,
        reason: 'Recording needs an SDK with standalone capture.',
      };
    },
  };
}

module.exports = { createVideoDBService, DEV_API, PROD_API, SDK_BRANCH };
