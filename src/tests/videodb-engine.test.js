const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createFixture, deferred, flush } = require('./helpers/fixture');
const { createRecordingCache } = require('../engine/videodb/cache');

const setup = async (t, options) => {
  const f = createFixture(options);
  t.after(() => f.engine.dispose());
  await f.command('signIn', { key: 'synthetic-key' });
  return f;
};

test('sign-in loads real-shaped empty state and never starts capture', async (t) => {
  const { engine, calls } = await setup(t);
  assert.equal(engine.getState().sample, false);
  assert.equal(engine.getState().account.status, 'signed-in');
  assert.equal(calls.length, 0);
  const copy = engine.getState();
  copy.sources.mic = false;
  assert.equal(engine.getState().sources.mic, true);
  assert(!JSON.stringify(copy).includes('synthetic-key'));
});

test('disabled audio is excluded before native start and server storage is always off', async (t) => {
  const f = await setup(t);
  await f.command('setSource', { key: 'mic', value: false });
  await f.command('start');
  const channels = f.calls.find(([name]) => name === 'start')[1].channels;
  assert.deepEqual(channels, [
    { channelId: 'display:1', type: 'video', isPrimary: true, store: false },
  ]);
  assert.equal(f.engine.getState().phase, 'recording');
});

test('selected sources are paused together and paused time is excluded from marks', async (t) => {
  const f = await setup(t);
  await f.command('setSource', { key: 'systemAudio', value: true });
  await f.command('start');
  f.advance(5000);
  await f.command('pause');
  f.advance(9000);
  assert.equal(f.engine.getState().elapsed, 5);
  assert.deepEqual(f.calls.find(([name]) => name === 'pause')[1], [
    'screen',
    'mic',
    'system_audio',
  ]);
  await f.command('resume');
  f.advance(3000);
  await f.command('pause');
  assert.equal(f.engine.getState().elapsed, 8);
});

test('Stop remains uncertain after rejection and another Start cannot overlap', async (t) => {
  const f = await setup(t);
  await f.command('start');
  f.recorder.stop = async () => {
    throw new Error('no response');
  };
  await f.command('stop');
  assert.equal(f.engine.getState().phase, 'stopped');
  assert.equal(f.engine.getState().problem.kind, 'capture-unknown');
  await f.command('start');
  assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
});

test('rejected Start is visible, no fake success appears, and no overlapping start is allowed', async (t) => {
  const f = await setup(t);
  f.recorder.start = async () => {
    throw new Error('native start rejected');
  };
  await f.command('start');
  assert.equal(f.engine.getState().phase, 'stopped');
  assert.equal(f.engine.getState().recordings[0].status, 'error');
  assert.equal(f.engine.getState().result, null);
});

test('a failed preflight leaves Start available after the permission is corrected', async (t) => {
  const f = await setup(t);
  f.recorder.permission.screen = false;
  await f.command('start');
  assert.equal(f.engine.getState().phase, 'idle');
  assert.equal(f.engine.getState().recordings.length, 0);
  f.recorder.permission.screen = true;
  await f.command('start');
  assert.equal(f.engine.getState().phase, 'recording');
});

test('Stop and relay acceptance do not imply playback; completion makes the same row ready', async (t) => {
  const f = await setup(t);
  await f.command('start');
  await f.command('stop');
  const id = f.engine.getState().recordings[0].id;
  assert.equal(f.engine.getState().phase, 'saving');
  assert.equal(f.engine.getState().result, null);
  f.recorder.finish();
  await flush();
  assert.equal(f.engine.getState().phase, 'finished');
  assert.equal(f.engine.getState().recordings.length, 1);
  assert.equal(f.engine.getState().result.id, id);
  // With the setting on (the default) a new recording is transcribed, then summarised.
  await f.engine.whenIdle();
  await flush();
  const ready = f.engine.getState().recordings[0];
  assert.equal(ready.transcriptStatus, 'ready');
  assert.equal(ready.paragraphs.length, 2);
  assert.equal(ready.summary.keyPoints[0].at, 0);
  assert.equal(ready.summaryStatus, 'ready');
});

test('with automatic transcription off, a new recording is left untranscribed', async (t) => {
  const f = await setup(t);
  await f.command('configure', { sources: {}, autoTranscribe: false });
  await f.command('start');
  await f.command('stop');
  f.recorder.finish();
  await flush();
  await f.engine.whenIdle();
  const record = f.engine.getState().recordings[0];
  assert.equal(record.status, 'ready');
  assert.equal(record.transcriptStatus, 'not-requested');
  assert.equal(record.summary, undefined);
  assert.equal(f.calls.some(([name]) => name === 'summarise'), false);
  // Asking for the transcript by hand still brings the summary with it.
  await f.command('requestTranscript', { id: record.id });
  assert.equal(f.engine.getState().recordings[0].summaryStatus, 'ready');
});

test('completion before the Stop response is not overwritten by a saving spinner', async (t) => {
  const f = await setup(t);
  await f.command('start');
  f.recorder.stop = async () => {
    f.recorder.finish();
    await flush();
  };
  await f.command('stop');
  await flush();
  assert.equal(f.engine.getState().phase, 'finished');
});

test('duplicate completion and a second recording do not duplicate or cross-wire results', async (t) => {
  const f = await setup(t);
  await f.command('start');
  await f.command('stop');
  const first = f.recorder.finish();
  await flush();
  f.recorder.emit('processing-complete', first);
  await flush();
  await f.command('newRecording');
  await f.command('start');
  await f.command('stop');
  f.recorder.finish();
  await flush();
  assert.equal(f.engine.getState().phase, 'finished');
  assert.equal(f.engine.getState().recordings.length, 2);
});

test('native unexpected stop clears the Recording indication and begins finalization', async (t) => {
  const f = await setup(t);
  await f.command('start');
  f.recorder.emit('recording-complete', {
    sessionId: f.engine.getState().sessionId,
  });
  await flush();
  assert.equal(f.engine.getState().phase, 'saving');
});

test('partial pause failure never claims that nothing is being captured', async (t) => {
  const f = await setup(t);
  await f.command('start');
  f.recorder.pause = async () => {
    throw new Error('partial failure');
  };
  await f.command('pause');
  assert.equal(f.engine.getState().phase, 'recording');
  assert.equal(f.engine.getState().problem.kind, 'pause-failed');
});

test('sign-out during pending upload is refused and cached work stays visible', async (t) => {
  const f = await setup(t);
  await f.command('start');
  await f.command('stop');
  await f.command('signOut');
  assert.equal(f.engine.getState().account.status, 'signed-in');
  assert.equal(f.engine.getState().recordings.length, 1);
});

test('native jobs owned by another account are not surfaced or relayed', async (t) => {
  const f = createFixture();
  t.after(() => f.engine.dispose());
  f.recorder.jobs = [
    {
      recordingId: 'foreign-job',
      sessionId: 'foreign-session',
      stage: 'awaiting_token',
      path: '/private/media.mp4',
    },
  ];
  f.service.ownsSession = async () => {
    throw new Error('forbidden');
  };
  await f.command('signIn', { key: 'synthetic-key' });
  assert.equal(f.engine.getState().recordings.length, 0);
  assert.equal(f.engine.getState().pending.length, 0);
});

test('restart discovers the retained job with no media path in renderer state', async (t) => {
  const f = createFixture();
  t.after(() => f.engine.dispose());
  f.recorder.jobs = [
    {
      recordingId: 'job-1',
      sessionId: 'session-old',
      stage: 'awaiting_token',
      path: '/private/media.mp4',
    },
  ];
  await f.command('signIn', { key: 'synthetic-key' });
  assert.equal(f.engine.getState().pending.length, 1);
  assert.equal(
    JSON.stringify(f.engine.getState()).includes('/private/'),
    false,
  );
});

test('cache saves marks but excludes signed URLs and preserves corrupt bytes for recovery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-cache-'));
  try {
    const file = path.join(dir, 'library.json');
    const cache = createRecordingCache(file);
    cache.save('a'.repeat(64), [
      {
        id: 'r',
        title: 'Title',
        marks: [{ at: 1, text: 'Note' }],
        streamUrl: 'https://secret.example/signed',
      },
    ]);
    assert(!fs.readFileSync(file, 'utf8').includes('secret.example'));
    assert.equal(
      createRecordingCache(file).load('a'.repeat(64))[0].marks[0].text,
      'Note',
    );
    fs.writeFileSync(file, 'corrupt');
    assert(createRecordingCache(file).warning);
    assert.equal(
      fs.readdirSync(dir).filter((f) => f.includes('.corrupt-')).length,
      1,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('source defaults do not overwrite a manual selection when appearance changes', async (t) => {
  const f = await setup(t);
  await f.command('setSource', { key: 'mic', value: false });
  await f.command('configure', {
    sources: { mic: true, systemAudio: false, camera: false },
  });
  assert.equal(f.engine.getState().sources.mic, false);
});

test('invalid, prototype and sample-only commands never enter the real engine', async (t) => {
  const f = await setup(t);
  assert.equal(f.engine.command('__proto__'), false);
  assert.equal(f.engine.command('simulate', { kind: 'connection' }), false);
  assert.equal(f.engine.command('signIn', { key: 123 }), false);
});

test('shutdown waits for Stop confirmation before requesting suspended upload recovery', async (t) => {
  const f = await setup(t);
  await f.command('start');
  const pending = deferred();
  f.recorder.stop = () => pending.promise;
  const quit = f.engine.shutdown({ suspend: true });
  assert.equal(
    f.calls.some(([name]) => name === 'shutdown'),
    false,
  );
  pending.resolve();
  await quit;
  assert.deepEqual(f.calls.find(([name]) => name === 'shutdown')[1], {
    suspend: true,
  });
});

test('installed SDK composes a signed-out real engine without native capture or credentials', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-sdk-engine-'));
  let engine;
  try {
    engine = require('../engine').createEngine({
      mode: 'videodb',
      dataDir: dir,
      safeStorage: { isEncryptionAvailable: () => false },
      permissionStatus: () => false,
    });
    await engine.ready;
    assert.equal(engine.getState().account.status, 'signed-out');
    assert.equal(engine.getState().sample, false);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    engine?.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a storage failure before native Start never leaves an endless starting state', async (t) => {
  const cache = createRecordingCache();
  const f = await setup(t, { cache });
  cache.save = () => {
    throw Object.assign(new Error('storage unavailable'), { code: 'storage' });
  };
  await f.command('start');
  assert.equal(
    f.calls.some(([name]) => name === 'start'),
    false,
  );
  assert.equal(f.engine.getState().phase, 'idle');
});

test('a confirmed Stop stays stopped even if the app cache cannot be written', async (t) => {
  const cache = createRecordingCache();
  const f = await setup(t, { cache });
  await f.command('start');
  cache.save = () => {
    throw Object.assign(new Error('storage unavailable'), { code: 'storage' });
  };
  await f.command('stop');
  assert.equal(f.engine.getState().phase, 'saving');
});

test('failed retained media can be left for recovery without blocking every later recording', async (t) => {
  const f = await setup(t);
  await f.command('start');
  await f.command('stop');
  f.recorder.emit('recording-relay-failed', {
    sessionId: f.engine.getState().sessionId,
  });
  await flush();
  assert.equal(f.engine.getState().phase, 'processing-error');
  await f.command('newRecording');
  assert.equal(f.engine.getState().phase, 'idle');
  assert.equal(f.engine.getState().recordings[0].paused, true);
  await f.command('start');
  assert.equal(f.engine.getState().phase, 'recording');
  assert.equal(f.engine.getState().recordings.length, 2);
});

test('a failed title update does not block an already playable recording', async (t) => {
  const f = await setup(t);
  await f.command('setPurpose', { text: 'Requested title' });
  await f.command('start');
  await f.command('stop');
  f.service.rename = async () => {
    throw new Error('rename failed');
  };
  f.recorder.finish();
  await flush();
  assert.equal(f.engine.getState().phase, 'finished');
  assert.equal(f.engine.getState().recordings[0].status, 'ready');
  assert.equal(f.engine.getState().recordings[0].pendingOperation, 'rename');
});

test('the account overview, a browsed collection and search are read-only views', async () => {
  const { engine, service, calls, command } = createFixture({
    records: [
      {
        id: 'v1',
        title: 'Standup',
        duration: 10,
        streamUrl: 'https://stream.example/v1.m3u8',
        playerUrl: 'https://player.example/v1',
      },
    ],
  });
  await command('signIn', { key: 'key' });
  let s = engine.getState();
  assert.equal(s.credits, 316.28);
  assert.deepEqual(
    s.collections.slice(0, 2).map((c) => c.name),
    ['Bloom Recordings', 'Product reviews'],
    'Bloom’s own collection comes first, the rest by name',
  );

  await command('openCollection', { id: 'collection-2' });
  s = engine.getState();
  assert.equal(s.browsing.status, 'ready');
  assert.deepEqual(
    s.browsing.recordings.map((r) => [r.title, r.readOnly, r.collectionId]),
    [
      ['Design critique', true, 'collection-2'],
      ['Sprint demo', true, 'collection-2'],
    ],
  );
  assert.equal(s.recordings.length, 1, 'Bloom’s own recordings are untouched');

  // A browsed video can be opened and read, never renamed or deleted.
  await command('openRecording', { id: 'shelf-1' });
  assert.equal(
    engine.getState().browsing.recordings[0].transcriptStatus,
    'ready',
  );
  await command('renameRecording', { id: 'shelf-1', text: 'Mine now' });
  await command('deleteRecording', { id: 'shelf-1' });
  assert.equal(
    calls.some(([name]) => name === 'rename'),
    false,
  );
  assert.equal(engine.getState().browsing.recordings.length, 2);

  // Bloom's own collection is the Recordings place, not a browsed one.
  await command('openCollection', { id: 'collection-1' });
  assert.equal(engine.getState().browsing, null);

  await command('search', { text: '  second thought ' });
  s = engine.getState();
  assert.equal(s.search.status, 'ready');
  assert.deepEqual(
    s.search.results.map((r) => [r.id, r.title, r.start]),
    [['v1', 'Standup', 4]],
  );
  await command('search', { text: 'nothing like this' });
  assert.deepEqual(engine.getState().search.results, []);
  await command('search', { text: '' });
  assert.equal(engine.getState().search.status, 'idle');

  await command('signOut');
  s = engine.getState();
  assert.deepEqual(
    [s.collections, s.credits, s.browsing, s.search.status],
    [[], null, null, 'idle'],
    'nothing about the account outlives sign-out',
  );
  assert.equal(typeof service.usage, 'function');
  engine.dispose();
});


test('collection actions update the sidebar and open collection, and protect the recording destination', async (t) => {
  const { engine, command, calls } = await setup(t);
  await command('openCollection', { id: 'collection-2' });
  await command('renameCollection', { id: 'collection-2', text: 'Reviews' });
  assert.equal(engine.getState().browsing.name, 'Reviews');
  assert.equal(engine.getState().collections.find((c) => c.id === 'collection-2').name, 'Reviews');
  await command('deleteCollection', { id: 'collection-2' });
  assert.equal(engine.getState().browsing, null);
  assert(!engine.getState().collections.some((c) => c.id === 'collection-2'));
  await command('renameCollection', { id: 'collection-1', text: 'Wrong' });
  await command('deleteCollection', { id: 'collection-1' });
  assert.equal(calls.filter(([name]) => /^(rename|delete)Collection$/.test(name)).length, 2);
});


test('an uncertain deleted collection remains reachable for reconciliation', async (t) => {
  const { engine, service, command } = await setup(t);
  const list = service.listCollections;
  service.pendingOperations = () => [{ key: 'collection:collection-2', kind: 'delete' }];
  service.listCollections = async () => (await list()).filter((c) => c.id !== 'collection-2');
  await command('refresh');
  assert.equal(engine.getState().collections.find((c) => c.id === 'collection-2').pendingOperation.kind, 'delete');
  service.reconcileCollectionAction = async () => {
    service.pendingOperations = () => [];
    return { reconciliationNeeded: false };
  };
  await command('reconcileCollectionAction', { id: 'collection-2' });
  assert(!engine.getState().collections.some((c) => c.id === 'collection-2'));
});


test('reconciling a collection rename refreshes its open heading', async (t) => {
  const { engine, service, command } = await setup(t);
  await command('openCollection', { id: 'collection-2' });
  await service.renameCollection('collection-2', 'Confirmed name');
  await command('reconcileCollectionAction', { id: 'collection-2' });
  assert.equal(engine.getState().browsing.name, 'Confirmed name');
});
