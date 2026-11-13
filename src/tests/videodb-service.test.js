const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createVideoDBService,
  DEV_API,
  PROD_API,
} = require('../engine/videodb/service');
const { createCredentialStore } = require('../engine/videodb/credentials');
const { createOperationJournal } = require('../engine/videodb/journal');
const { createVideoDBBoundary } = require('../engine/videodb');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function fixture(options = {}) {
  const calls = [];
  const item = {
    id: 'video-1',
    name: 'Original',
    length: 12,
    streamUrl: 'https://stream.example/video.m3u8',
    playerUrl: 'https://player.example/video-1',
    async update({ name }) {
      calls.push(['rename', name]);
      this.name = name;
    },
    async delete() {
      calls.push(['delete']);
    },
    async getTranscript() {
      calls.push(['transcript']);
      return {
        text: 'Hello',
        // The shape VideoDB returns: the word is `text`, and "-" marks a silence.
        wordTimestamps: [
          { text: '-', start: 0, end: 0.3 },
          { text: 'Hello', start: 0.3, end: 1, speaker: 'A' },
        ],
      };
    },
    async indexSpokenWords() {
      calls.push(['index']);
      return { success: true };
    },
    async download() {
      calls.push(['download']);
      return {
        url: 'https://download.example/video.mp4',
        secret: 'do not return',
      };
    },
  };
  const coll = {
    id: 'bloom-collection',
    name: 'Bloom Recordings',
    async getVideos() {
      calls.push(['list', this.id]);
      return [item];
    },
    async getVideo(id) {
      calls.push(['get', this.id, id]);
      return item;
    },
  };
  const conn = {
    async getCollections() {
      return [coll];
    },
    async createCollection(...args) {
      calls.push(['create', ...args]);
      return coll;
    },
    async generateClientToken() {
      calls.push(['token']);
      return 'synthetic-recorder-token';
    },
  };
  const connect = (args) => {
    calls.push(['connect', args.baseUrl]);
    return conn;
  };
  const service = createVideoDBService({ connect, ...options });
  return { service, item, coll, conn, calls };
}
const login = (service, key = 'synthetic-test-key') => service.signIn(key);

test('default dev origin and all video operations stay in the Bloom collection', async () => {
  const { service, calls } = fixture();
  const identity = await login(service);
  assert.equal(identity.apiUrl, DEV_API);
  assert.equal(identity.collectionId, 'bloom-collection');
  assert.equal((await service.listRecordings())[0].title, 'Original');
  assert.equal(
    (await service.getPlayback('video-1')).playerUrl,
    'https://player.example/video-1',
  );
  await service.rename('video-1', 'Renamed');
  await service.transcript('video-1');
  await service.deleteRecording('video-1');
  assert(
    calls
      .filter(([name]) => name === 'get')
      .every(([, id]) => id === 'bloom-collection'),
  );
});

test('production is explicit and arbitrary origins are rejected before connection', async () => {
  const { service, calls } = fixture({ apiUrl: PROD_API });
  await login(service);
  assert.deepEqual(calls[0], ['connect', PROD_API]);
  assert.throws(() => fixture({ apiUrl: 'http://localhost:8888' }), {
    code: 'invalid-environment',
  });
});

test('sign-in and empty library do not create a remote collection', async () => {
  const { service, conn, calls } = fixture();
  conn.getCollections = async () => [];
  await login(service);
  assert.deepEqual(await service.listRecordings(), []);
  assert.equal(
    calls.some(([name]) => name === 'create'),
    false,
  );
  await service.ensureCollection();
  await service.ensureCollection();
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(calls.find(([name]) => name === 'create')[3], false);
});

test('raw SDK errors containing credentials never cross the service boundary', async () => {
  const { service, conn } = fixture();
  conn.getCollections = async () => {
    throw Object.assign(
      new Error('synthetic-secret https://private.example/token'),
      { response: { status: 401 } },
    );
  };
  await assert.rejects(
    login(service),
    (error) =>
      error.code === 'authentication' &&
      !error.stack.includes('synthetic-secret'),
  );
});

test('failed sign-in never saves credentials or replaces an existing connection', async () => {
  const saved = [];
  const { service, conn } = fixture({
    credentials: { write: (key) => saved.push(key) },
  });
  await login(service);
  conn.getCollections = async () => {
    throw new Error('offline');
  };
  await assert.rejects(login(service, 'different-synthetic-key'), {
    code: 'unavailable',
  });
  assert.equal(saved.length, 1);
  assert.equal((await service.listRecordings()).length, 1);
});

test('sign-out invalidates a delayed read and never returns another account data', async () => {
  const pending = deferred();
  const { service, coll } = fixture();
  await login(service);
  coll.getVideos = () => pending.promise;
  const list = service.listRecordings();
  service.signOut();
  pending.resolve([]);
  await assert.rejects(list, { code: 'account-changed' });
});

test('sign-out cancels an outstanding sign-in before the credential is saved', async () => {
  const pending = deferred();
  let saved = false;
  const { service, conn } = fixture({
    credentials: {
      write() {
        saved = true;
      },
      clear() {},
    },
  });
  conn.getCollections = () => pending.promise;
  const signingIn = login(service);
  service.signOut();
  pending.resolve([]);
  await assert.rejects(signingIn, { code: 'account-changed' });
  assert.equal(saved, false);
});

test('operation failures do not report success or discard the retry handle', async () => {
  const { service, item } = fixture();
  await login(service);
  item.delete = async () => {
    throw new Error('offline');
  };
  await assert.rejects(
    service.deleteRecording('video-1'),
    (error) => error.code === 'unavailable' && error.uncertain,
  );
  await assert.rejects(service.deleteRecording('video-1'), {
    code: 'reconciliation-needed',
  });
  assert.equal((await service.reconcileRecording('video-1')).exists, true);
  assert.throws(() => service.signOut(), { code: 'busy' });
});

test('a timed-out rename is not replayed; late success is reconciled by the intended title', async () => {
  const pending = deferred();
  const { service, item } = fixture({ timeoutMs: 20 });
  await login(service);
  item.update = async ({ name }) => {
    await pending.promise;
    item.name = name;
  };
  await assert.rejects(
    service.rename('video-1', 'Final title'),
    (error) => error.code === 'timeout' && error.uncertain,
  );
  await assert.rejects(service.rename('video-1', 'Different title'), {
    code: 'reconciliation-needed',
  });
  assert.equal(
    (await service.reconcileRecording('video-1')).reconciliationNeeded,
    true,
  );
  pending.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await service.reconcileRecording('video-1')).reconciliationNeeded,
    false,
  );
  service.signOut();
});

test('an in-flight rename rejects overlapping mutations and account switching', async () => {
  const pending = deferred();
  const { service, item } = fixture();
  await login(service);
  item.update = () => pending.promise;
  const rename = service.rename('video-1', 'Name');
  await assert.rejects(service.deleteRecording('video-1'), { code: 'busy' });
  await assert.rejects(login(service, 'another-key'), { code: 'busy' });
  pending.resolve();
  await rename;
});

test('pending mutation survives restart and never crosses account or environment scope', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-journal-'));
  try {
    const file = path.join(dir, 'operations.json');
    const first = fixture({
      journal: createOperationJournal(file),
      timeoutMs: 10,
    });
    await login(first.service);
    first.item.update = () => new Promise(() => {});
    await assert.rejects(first.service.rename('video-1', 'Intended name'), {
      code: 'timeout',
    });
    const second = fixture({ journal: createOperationJournal(file) });
    await login(second.service);
    await assert.rejects(second.service.rename('video-1', 'Duplicate'), {
      code: 'reconciliation-needed',
    });
    second.item.name = 'Intended name';
    assert.equal(
      (await second.service.reconcileRecording('video-1')).reconciliationNeeded,
      false,
    );
    const other = fixture({
      journal: createOperationJournal(file),
      apiUrl: PROD_API,
    });
    await login(other.service);
    await other.service.rename('video-1', 'Production name');
    assert(!fs.readFileSync(file, 'utf8').includes('synthetic-test-key'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('transcript fetch is read-only, preserves word timing, and rejects service errors', async () => {
  const { service, item, calls } = fixture();
  await login(service);
  const result = await service.transcript('video-1');
  assert.deepEqual(
    result.words,
    [{ word: 'Hello', start: 0.3, end: 1 }],
    'the silence marker is dropped',
  );
  assert.equal(
    calls.some(([name]) => name === 'index'),
    false,
  );
  item.getTranscript = async () => {
    throw new Error('index unavailable');
  };
  await assert.rejects(service.transcript('video-1'), { code: 'unavailable' });
});

test('empty or malformed transcript does not turn into a no-speech success', async () => {
  const { service, item } = fixture();
  await login(service);
  item.getTranscript = async () => ({ text: '', wordTimestamps: [] });
  assert.equal((await service.transcript('video-1')).status, 'empty');
  item.getTranscript = async () => ({});
  await assert.rejects(service.transcript('video-1'), {
    code: 'invalid-response',
  });
});

test('explicit paid indexing checks acknowledgement and deduplicates successful requests', async () => {
  const { service, item, calls } = fixture();
  await login(service);
  item.indexSpokenWords = async () => ({ success: false });
  await assert.rejects(service.requestTranscript('video-1'), {
    code: 'indexing',
  });
  item.indexSpokenWords = async () => {
    calls.push(['index']);
    return { success: true };
  };
  await service.requestTranscript('video-1');
  await service.requestTranscript('video-1');
  assert.equal(calls.filter(([name]) => name === 'index').length, 1);
});

test('download returns only a secure URL and safe filename, not raw SDK metadata', async () => {
  const { service, item } = fixture();
  await login(service);
  assert.deepEqual(await service.prepareDownload('video-1'), {
    url: 'https://download.example/video.mp4',
    name: 'video-1.mp4',
  });
  item.streamUrl = 'javascript:alert(1)';
  assert.equal((await service.getPlayback('video-1')).streamUrl, null);
  item.download = async () => ({ url: 'http://download.example/file' });
  await assert.rejects(service.prepareDownload('video-1'), {
    code: 'invalid-response',
  });
});

test('published legacy client is gated without spawning a binary or creating a session', () => {
  class LegacyClient {
    constructor() {
      assert.fail('must not instantiate');
    }
  }
  const { service } = fixture({ CaptureClient: LegacyClient });
  assert.deepEqual(service.captureCapabilities().missing, [
    'relayRecording',
    'listLocalRecordings',
    'waitForProcessing',
  ]);
  assert.equal(service.captureCapabilities().supported, false);
});

test('credential persistence requires secure storage and atomic encrypted bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-credentials-'));
  try {
    const file = path.join(dir, 'credential');
    const safeStorage = { isEncryptionAvailable: () => false };
    const store = createCredentialStore({ file, safeStorage });
    assert.equal(store.read(), null);
    assert.throws(() => store.write('synthetic-test-key'), {
      code: 'secure-storage',
    });
    assert.equal(fs.existsSync(file), false);
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = () => Buffer.from('encrypted-test-bytes');
    safeStorage.decryptString = (bytes) => {
      assert.equal(bytes.toString(), 'encrypted-test-bytes');
      return 'synthetic-test-key';
    };
    store.write('synthetic-test-key');
    assert.equal(store.read(), 'synthetic-test-key');
    assert(!fs.readFileSync(file, 'utf8').includes('synthetic-test-key'));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    store.clear();
    assert.equal(store.read(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt credential and journal files are retained, never silently reset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-corrupt-'));
  try {
    const file = path.join(dir, 'data');
    fs.writeFileSync(file, 'corrupt');
    const store = createCredentialStore({
      file,
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString() {
          throw new Error('raw keychain failure');
        },
      },
    });
    assert.throws(() => store.read(), { code: 'secure-storage' });
    assert.throws(() => createOperationJournal(file), {
      code: 'journal-corrupt',
    });
    assert.equal(fs.readFileSync(file, 'utf8'), 'corrupt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('journal rejects credentials and extra fields', () => {
  const journal = createOperationJournal();
  assert.throws(
    () =>
      journal.put({
        scopeId: 'a'.repeat(64),
        key: 'video:1',
        kind: 'delete',
        state: 'pending',
        apiKey: 'synthetic-key',
      }),
    { code: 'invalid-input' },
  );
});

test('pending work must be durable before any remote mutation is issued', async () => {
  const journal = {
    list: () => [],
    put() {
      throw Object.assign(new Error('safe'), { code: 'storage' });
    },
  };
  const { service, calls } = fixture({ journal });
  await login(service);
  await assert.rejects(service.deleteRecording('video-1'), { code: 'storage' });
  assert.equal(
    calls.some(([name]) => name === 'delete'),
    false,
  );
});

test('SDK AuthenticationError and SDK timeout classes are sanitized without response metadata', async () => {
  class AuthenticationError extends Error {}
  const { service, conn, item } = fixture();
  conn.getCollections = async () => {
    throw new AuthenticationError('synthetic-secret');
  };
  await assert.rejects(login(service), { code: 'authentication' });
  conn.getCollections = async () => [
    {
      id: 'bloom-collection',
      name: 'Bloom Recordings',
      getVideo: async () => item,
    },
  ];
  await login(service);
  item.delete = async () => {
    throw Object.assign(new Error('synthetic-secret'), {
      name: 'RequestTimeoutError',
    });
  };
  await assert.rejects(
    service.deleteRecording('video-1'),
    (error) =>
      error.code === 'timeout' &&
      error.uncertain &&
      !error.stack.includes('synthetic-secret'),
  );
});

test('a failed read before rename does not leave a false pending remote mutation', async () => {
  const { service, coll } = fixture();
  await login(service);
  coll.getVideo = async () => {
    throw new Error('offline');
  };
  await assert.rejects(service.rename('video-1', 'Name'), {
    code: 'unavailable',
  });
  assert.deepEqual(service.pendingOperations(), []);
  service.signOut();
});

test('duplicate collection names are not silently resolved to an arbitrary collection', async () => {
  const { service, conn, coll } = fixture();
  conn.getCollections = async () => [
    coll,
    { ...coll, id: 'another-collection' },
  ];
  // Multiple matching collections require an explicit binding rather than changing user data.
  await assert.rejects(login(service), { code: 'collection-ambiguous' });
});

test('the composed boundary never restores a dev credential into production', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-environments-'));
  try {
    const { conn } = fixture();
    let connections = 0;
    const dependencies = {
      dataDir: dir,
      sdk: {
        connect() {
          connections += 1;
          return conn;
        },
      },
      captureSdk: { CaptureClient: class {} },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: () => Buffer.from('encrypted-test-bytes'),
        decryptString: () => 'synthetic-test-key',
      },
    };
    const dev = createVideoDBBoundary(dependencies);
    await login(dev);
    const prod = createVideoDBBoundary({ ...dependencies, apiUrl: PROD_API });
    assert.equal(await prod.restore(), null);
    assert.equal(connections, 1);
    assert.equal(fs.existsSync(path.join(dir, 'videodb-dev', 'key.enc')), true);
    assert.equal(
      fs.existsSync(path.join(dir, 'videodb-prod', 'key.enc')),
      false,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recorder tokens are freshly minted for the verified session end-user', async () => {
  const { service, coll, conn } = fixture();
  let issued = 0;
  coll.getCaptureSession = async (id) => ({
    id,
    collectionId: coll.id,
    endUserId: 'session-owner',
  });
  conn.generateClientToken = async (ttl, userId) => {
    assert.equal(ttl, 3600);
    assert.equal(userId, 'session-owner');
    return `synthetic-token-${++issued}`;
  };
  await login(service);
  assert.notEqual(
    await service.recorderToken({ sessionId: 'session-1' }),
    await service.recorderToken({ sessionId: 'session-1' }),
  );
  coll.getCaptureSession = async () => ({
    collectionId: 'another-collection',
    endUserId: 'different-owner',
  });
  await assert.rejects(service.recorderToken({ sessionId: 'foreign' }), {
    code: 'forbidden',
  });
  assert.equal(issued, 2);
});

test('an uncertain session creation is reconciled by its durable operation identity', async () => {
  const { service, coll } = fixture();
  await login(service);
  let metadata;
  coll.createCaptureSession = async (options) => {
    metadata = options.metadata;
    throw new Error('response lost');
  };
  await assert.rejects(
    service.createSession('operation-1'),
    (error) => error.uncertain,
  );
  coll.listCaptureSessions = async () => [{ id: 'session-1', metadata }];
  assert.equal((await service.reconcileSession()).reconciliationNeeded, false);
  assert.deepEqual(service.pendingOperations(), []);
});


test('collection mutations preserve descriptions, protect the destination and reconcile uncertain deletion', async () => {
  const { service, conn, calls } = fixture({ timeoutMs: 30 });
  await login(service);
  let remote = { id: 'other', name: 'Other', description: 'Keep this description',
    delete: async () => { calls.push(['deleteCollection']); remote = null; throw new Error('response lost'); } };
  conn.getCollection = async () => {
    if (!remote) throw { status: 404 };
    return remote;
  };
  conn.updateCollection = async (id, name, description) => {
    calls.push(['renameCollection', id, name, description]);
    remote.name = name;
    return remote;
  };
  await assert.rejects(service.renameCollection('bloom-collection', 'Other'), { code: 'protected' });
  await assert.rejects(service.deleteCollection('bloom-collection'), { code: 'protected' });
  await assert.rejects(service.renameCollection('other', 'Bloom Recordings'), { code: 'invalid-input' });
  await service.renameCollection('other', 'Renamed');
  assert.deepEqual(calls.at(-1), ['renameCollection', 'other', 'Renamed', 'Keep this description']);
  await assert.rejects(service.deleteCollection('other'), { uncertain: true });
  assert.equal(service.pendingOperations()[0].key, 'collection:other');
  assert.deepEqual(await service.reconcileCollectionAction('other'), { reconciliationNeeded: false });
  assert.deepEqual(service.pendingOperations(), []);
  assert.equal(calls.filter(([name]) => name === 'deleteCollection').length, 1);
});

test('uncertain collection rename is not replayed until its result is confirmed', async () => {
  const { service, conn } = fixture({ timeoutMs: 10 });
  await login(service);
  let name = 'Original';
  let count = 0;
  conn.getCollection = async () => ({ name });
  conn.updateCollection = async () => { count++; throw new Error('offline'); };
  await assert.rejects(service.renameCollection('other', 'New'), { uncertain: true });
  assert.deepEqual(await service.reconcileCollectionAction('other'), { reconciliationNeeded: true });
  await assert.rejects(service.renameCollection('other', 'New'), { code: 'reconciliation-needed' });
  assert.equal(count, 1);
  name = 'New';
  assert.deepEqual(await service.reconcileCollectionAction('other'), { reconciliationNeeded: false });
});
