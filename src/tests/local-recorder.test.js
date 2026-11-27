// The managed recorder adapter against a fake SDK client and a fake service: VideoDB
// authorises a recording before capture, the recorder sends it after Stop, and Bloom only
// ever deals in recording ids (ADR 0007).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLocalRecorder } = require('../engine/videodb/local-recorder');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const OWNER = `bloom-${'a'.repeat(24)}`;

class CaptureCommandError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CaptureCommandError';
    this.code = code;
  }
}

function fixture({ managed = true, jobs = [] } = {}) {
  const calls = [];
  const waits = new Map(); // recordingId -> { resolve, reject }
  let serial = 0;
  let startError = null;
  let stopError = null;
  let client = null;
  class Client extends EventEmitter {
    constructor(options) {
      super();
      calls.push(['construct', options.apiUrl]);
      this.getRecorderToken = options.getRecorderToken;
      this.jobs = jobs;
      client = this;
    }
    async getCapabilities() {
      return { managedDeferredRecording: managed };
    }
    async listChannels() {
      return {
        displays: [{ id: 'display:1', name: 'Built-in display' }],
        mics: [
          { id: 'mic:usb', name: 'USB mic' },
          { id: 'mic:default', name: 'Default' },
        ],
        systemAudio: [{ id: 'system_audio:default', name: 'System audio' }],
      };
    }
    async getWindows() {
      return {
        supported: true,
        supportsDeferredWindow: true,
        windows: [
          {
            channelId: 'window:1',
            appName: 'Notes',
            title: 'Plan',
            bundleId: 'com.apple.Notes',
            width: 900,
            height: 600,
            isOnScreen: true,
          },
          {
            channelId: 'window:2',
            appName: 'Notes',
            title: '',
            bundleId: 'com.apple.Notes',
            width: 400,
            height: 300,
            isOnScreen: false,
          },
          {
            channelId: 'window:3',
            appName: 'Bloom',
            title: 'Bloom',
            bundleId: 'com.videodb.bloom',
            width: 1180,
            height: 760,
            isOnScreen: true,
          },
        ],
      };
    }
    async startRecording(options) {
      calls.push(['start', options]);
      if (startError) {
        const error = startError;
        startError = null;
        throw error;
      }
      return { recordingId: `rec-${++serial}` };
    }
    async stopRecording() {
      calls.push(['stop']);
      if (stopError) {
        const error = stopError;
        stopError = null;
        throw error;
      }
      return {
        recordingId: `rec-${serial}`,
        status: 'ready',
        durationSeconds: 12.5,
      };
    }
    async listRecordings({ owner }) {
      calls.push(['list', owner]);
      return this.jobs.filter((job) => job.owner === owner);
    }
    async relayRecording(options) {
      calls.push(['relay', options]);
      const job = this.jobs.find((j) => j.recordingId === options.recordingId);
      return job?.stage === 'complete'
        ? {
            recordingId: job.recordingId,
            status: 'complete',
            result: job.result,
          }
        : { recordingId: options.recordingId, status: 'accepted' };
    }
    waitForProcessing({ recordingId }) {
      calls.push(['wait', recordingId]);
      return new Promise((resolve, reject) =>
        waits.set(recordingId, { resolve, reject }),
      );
    }
    async pauseTracks(tracks) {
      calls.push(['pause', tracks]);
    }
    async resumeTracks(tracks) {
      calls.push(['resume', tracks]);
    }
    async shutdown(options) {
      calls.push(['shutdown', options]);
    }
  }
  let minted = 0;
  const service = {
    apiUrl: 'https://api.dev.videodb.io',
    scopeId: 'a'.repeat(64),
    offline: false,
    cachedIdentity: () =>
      service.scopeId ? { scopeId: service.scopeId } : null,
    async recorderAuthorization({ owner, collectionId }) {
      if (service.offline) throw new Error('getaddrinfo ENOTFOUND');
      calls.push(['authorise', owner, collectionId]);
      return {
        token: `token-${++minted}`,
        collectionId: collectionId || 'collection-bloom',
      };
    },
  };
  const recorder = createLocalRecorder({
    CaptureClient: Client,
    service,
    permissionStatus: () => true,
  });
  const events = [];
  recorder.onEvent((name, payload) => events.push([name, payload]));
  return {
    recorder,
    service,
    calls,
    events,
    client: () => client,
    named: (name) => calls.filter(([n]) => n === name),
    failStart(error) {
      startError = error;
    },
    failStop(error) {
      stopError = error;
    },
    // The recorder says VideoDB has the recording, as the SDK does: an event and the wait.
    complete(recordingId, videoId = `video-${recordingId}`) {
      const payload = { recordingId, owner: OWNER, result: { videoId } };
      client.emit('processing-complete', payload);
      waits.get(recordingId)?.resolve(payload);
    },
    fail(recordingId) {
      client.emit('processing-failed', {
        recordingId,
        owner: OWNER,
        errorCode: 'UPLOAD_FAILED',
      });
      waits.get(recordingId)?.reject(new CaptureCommandError('UPLOAD_FAILED'));
    },
  };
}
const channels = [
  { channelId: 'display:1', type: 'video', isPrimary: true, store: false },
  { channelId: 'mic:default', type: 'audio', store: false },
];

test('Start is authorised by VideoDB first; only the default sound sources are offered', async () => {
  const f = fixture();
  const found = await f.recorder.channels();
  assert.deepEqual(found.mics, [{ id: 'mic:default', name: 'Microphone' }]);
  const started = await f.recorder.start({
    sessionId: 'rec-a',
    channels,
    title: 'Demo',
  });
  assert.deepEqual(started, { recordingId: 'rec-1' });
  assert.deepEqual(f.named('construct'), [
    ['construct', 'https://api.dev.videodb.io'],
  ]);
  assert.deepEqual(f.named('authorise'), [['authorise', OWNER, undefined]]);
  assert.deepEqual(f.named('start')[0][1], {
    live: false,
    owner: OWNER,
    collectionId: 'collection-bloom',
    uploadToken: 'token-1',
    name: 'Demo',
    channels: [
      { channelId: 'display:1', type: 'video' },
      { channelId: 'mic:default', type: 'audio' },
    ],
  });
});

test('a Start that cannot be authorised, or that the recorder refuses, is a plain no', async () => {
  const offline = fixture();
  offline.service.offline = true;
  await assert.rejects(
    offline.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' }),
    (error) =>
      error.refused === true && /Check your connection/.test(error.message),
  );
  assert.equal(offline.named('start').length, 0, 'nothing was captured');

  const outdated = fixture({ managed: false });
  await assert.rejects(
    outdated.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' }),
    { refused: true },
  );
  assert.equal(outdated.named('start').length, 0);

  const refused = fixture();
  refused.failStart(new CaptureCommandError('TARGET_NOT_FOUND'));
  await assert.rejects(
    refused.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' }),
    (error) =>
      error.refused === true && /no longer available/.test(error.message),
  );
  // No answer at all is not a refusal: capture may have begun.
  const silent = fixture();
  silent.failStart(new Error('socket closed'));
  await assert.rejects(
    silent.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' }),
    (error) => error.refused === undefined,
  );

  const signedOut = fixture();
  signedOut.service.scopeId = null;
  await assert.rejects(
    signedOut.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' }),
    { code: 'signed-out' },
  );
});

test('after Stop the recorder sends the recording; Bloom only waits for the video', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.stop();
  assert.deepEqual(f.events.at(-1), [
    'local-recording-ready',
    {
      recordingId: 'rec-1',
      sessionId: 'rec-a',
      stage: 'processing',
      metadata: { duration_seconds: 12.5 },
    },
  ]);
  const waiting = f.recorder.wait({ sessionId: 'rec-a' });
  await flush();
  f.complete('rec-1');
  assert.deepEqual(await waiting, {
    recordingId: 'rec-1',
    sessionId: 'rec-a',
    result: { videoId: 'video-rec-1' },
  });
  assert.deepEqual(f.events.at(-1), [
    'processing-complete',
    {
      recordingId: 'rec-1',
      sessionId: 'rec-a',
      result: { videoId: 'video-rec-1' },
    },
  ]);
  assert.equal(f.named('relay').length, 0, 'Bloom sends nothing itself');
  assert.equal(
    JSON.stringify(f.events).includes('/'),
    false,
    'no path ever reaches the engine',
  );
});

test('the recorder gets a fresh token whenever it asks, for this account only', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  const ask = f.client().getRecorderToken;
  const request = {
    recordingId: 'rec-1',
    owner: OWNER,
    collectionId: 'collection-then',
    purpose: 'recording-delivery',
    forceRefresh: true,
  };
  assert.equal(await ask(request), 'token-2');
  assert.equal(await ask(request), 'token-3');
  assert.deepEqual(f.named('authorise').at(-1), [
    'authorise',
    OWNER,
    'collection-then',
  ]);
  assert.equal(await ask({ ...request, owner: 'bloom-someone-else' }), null);
});

test('a recording that fails to reach VideoDB is reported, and handing it back sends it once', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.stop();
  const waiting = f.recorder.wait({ sessionId: 'rec-a' });
  await flush();
  f.fail('rec-1');
  await assert.rejects(waiting, { code: 'unavailable' });
  // Not final: the recorder still has it and can send it again.
  assert.deepEqual(f.events.at(-1), [
    'recording-relay-failed',
    { recordingId: 'rec-1', sessionId: 'rec-a', permanent: false },
  ]);
  f.client().jobs = [
    { recordingId: 'rec-1', owner: OWNER, stage: 'needs_recovery' },
  ];
  await f.recorder.relay('rec-1');
  const relayed = f.named('relay').at(-1)[1];
  assert.deepEqual(relayed, {
    recordingId: 'rec-1',
    owner: OWNER,
    uploadToken: 'token-2',
  });
  const again = f.recorder.wait({ recordingId: 'rec-1' });
  await flush();
  assert.equal(f.named('relay').length, 1, 'taken on once, not twice');
  f.complete('rec-1');
  assert.equal((await again).result.videoId, 'video-rec-1');
});

test('Recover says plainly when the recorder never had a recording, and never sends a finished one', async () => {
  const f = fixture({
    jobs: [
      {
        recordingId: 'rec-done',
        owner: OWNER,
        stage: 'complete',
        result: { videoId: 'video-done' },
      },
    ],
  });
  await assert.rejects(f.recorder.relay('from-2.3'), {
    code: 'not-found',
    message: /earlier version of Bloom/,
  });
  await f.recorder.relay('rec-done');
  assert.equal(f.named('relay').length, 0);
  assert.deepEqual(f.events.at(-1), [
    'processing-complete',
    {
      recordingId: 'rec-done',
      sessionId: undefined,
      result: { videoId: 'video-done' },
    },
  ]);
});

test('after a restart the recorder lists this account only, and an unfinished one is sent on', async () => {
  const job = (recordingId, stage, extra = {}) => ({
    recordingId,
    owner: OWNER,
    stage,
    durationSeconds: 9,
    ...extra,
  });
  const f = fixture({
    jobs: [
      job('rec-ready', 'ready'),
      job('rec-uploaded', 'uploaded'),
      job('rec-done', 'complete', { result: { videoId: 'video-done' } }),
      job('rec-broken', 'needs_recovery'),
      job('rec-cut', 'recording'),
      job('rec-dropped', 'discarded'),
      { ...job('rec-theirs', 'ready'), owner: 'bloom-someone-else' },
    ],
  });
  const found = await f.recorder.recover();
  assert.deepEqual(
    found.map(({ recordingId, stage }) => [recordingId, stage]),
    [
      ['rec-ready', 'processing'],
      ['rec-uploaded', 'processing'],
      ['rec-done', 'complete'],
      ['rec-broken', 'failed'],
      ['rec-cut', 'failed'],
    ],
  );
  assert.equal(found[2].result.videoId, 'video-done');
  assert.equal(f.named('relay').length, 0, 'listing sends nothing');
  // Waiting for one found after a restart hands it back to the recorder first.
  const waiting = f.recorder.wait({ recordingId: 'rec-ready' });
  await flush();
  await flush();
  assert.equal(f.named('relay').at(-1)[1].recordingId, 'rec-ready');
  f.complete('rec-ready');
  assert.equal((await waiting).result.videoId, 'video-rec-ready');
  // A finished one resolves at once; a broken one is not sent without Recover.
  assert.equal(
    (await f.recorder.wait({ recordingId: 'rec-done' })).result.videoId,
    'video-done',
  );
  await assert.rejects(f.recorder.wait({ recordingId: 'rec-broken' }), {
    code: 'unavailable',
  });
  assert.equal(f.named('relay').length, 1);
});

test('the recording being captured is never listed for recovery', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  f.client().jobs = [
    { recordingId: 'rec-1', owner: OWNER, stage: 'recording' },
  ];
  assert.deepEqual(await f.recorder.recover(), []);
});

test('a capture that could not be finished ends Stop; one that may still run keeps Stop available', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  f.failStop(new CaptureCommandError('FINALIZE_FAILED'));
  assert.equal(await f.recorder.stop(), undefined);
  f.client().jobs = [{ recordingId: 'rec-1', owner: OWNER, stage: 'failed' }];
  await assert.rejects(f.recorder.wait({ sessionId: 'rec-a' }), {
    code: 'unavailable',
  });

  const unsure = fixture();
  await unsure.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  unsure.failStop(new Error('socket closed'));
  await assert.rejects(unsure.recorder.stop());
  // The recorder says nothing is being recorded, and Bloom knew of nothing either.
  const idle = fixture();
  idle.failStop(new Error('No managed recording is active'));
  assert.deepEqual(await idle.recorder.stop(), { nothing: true });
});

test('quitting finishes a capture first and never waits for a recording to reach VideoDB', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.pause(['screen']);
  assert.deepEqual(f.named('pause')[0][1], ['display:1']);
  await f.recorder.shutdown();
  assert.deepEqual(
    f.calls.slice(-3).map(([name]) => name),
    ['pause', 'stop', 'shutdown'],
  );
  assert.deepEqual(f.named('shutdown')[0][1], { waitForProcessing: false });
});

test("only windows that can be recorded are offered: on screen, and not Bloom's own", async () => {
  const f = fixture();
  assert.deepEqual(await f.recorder.windows(), {
    supported: true,
    windows: [
      { id: 'window:1', app: 'Notes', title: 'Plan', width: 900, height: 600 },
    ],
  });
});

test('the microphone is asked for by Bloom itself, and its answer is the status', async () => {
  const { createLocalRecorder } = require('../engine/videodb/local-recorder');
  const asked = [];
  const make = (answer) =>
    createLocalRecorder({
      CaptureClient: class extends EventEmitter {
        async requestPermission(kind) {
          asked.push(['recorder', kind]);
        }
      },
      service: { cachedIdentity: () => null },
      // macOS's own reading in this process still says "not asked" after the answer.
      permissionStatus: () => false,
      permissionDecided: () => false,
      askMicrophone: async () => {
        asked.push(['bloom', 'microphone']);
        return answer;
      },
    });
  const yes = make(true);
  const after = await yes.requestPermission('mic');
  assert.equal(after.mic, true);
  assert.equal(after.micDecided, true);
  assert.equal(yes.permissions().mic, true, 'and it stays so');
  const no = make(false);
  assert.equal((await no.requestPermission('mic')).mic, false);
  assert.deepEqual(
    asked,
    [
      ['bloom', 'microphone'],
      ['bloom', 'microphone'],
    ],
    'the recorder is never asked for the microphone',
  );
  // Screen Recording still goes through the recorder.
  await yes.requestPermission('screen');
  assert.deepEqual(asked.at(-1), ['recorder', 'screen-capture']);
});

test('the recorder’s progress reaches the engine, and a reopened Bloom sees it in the list', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.stop();
  f.client().emit('processing-progress', {
    recordingId: 'rec-1',
    owner: OWNER,
    percent: 43,
    etaSeconds: 120,
  });
  // Another account's recording says nothing here.
  f.client().emit('processing-progress', {
    recordingId: 'rec-x',
    owner: 'bloom-someone-else',
    percent: 10,
    etaSeconds: null,
  });
  assert.deepEqual(
    f.events.filter(([name]) => name === 'recording-progress'),
    [['recording-progress', { recordingId: 'rec-1', sessionId: 'rec-a', progress: 0.43 }]],
  );
  f.client().jobs = [
    {
      recordingId: 'rec-1',
      owner: OWNER,
      stage: 'uploaded',
      partial: false,
      partialReason: null,
      progress: { percent: 61, etaSeconds: null },
    },
  ];
  const [listed] = await f.recorder.recover();
  assert.equal(listed.stage, 'processing');
  assert.equal(listed.progress, 0.61);
});

test('only a delivery the recorder says it cannot retry is final', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.stop();
  f.client().emit('processing-failed', {
    recordingId: 'rec-1',
    owner: OWNER,
    errorCode: 'GONE',
    retryable: false,
  });
  assert.deepEqual(f.events.at(-1), [
    'recording-relay-failed',
    { recordingId: 'rec-1', sessionId: 'rec-a', permanent: true },
  ]);
});

test('a delivery the recorder is still retrying waits for a connection without Bloom stepping in', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.stop();
  f.client().emit('processing-failed', {
    recordingId: 'rec-1',
    owner: OWNER,
    errorCode: 'NETWORK',
    retryable: true,
    retrying: true,
  });
  assert.deepEqual(f.events.at(-1), [
    'recording-relay-failed',
    { recordingId: 'rec-1', sessionId: 'rec-a', permanent: false, retrying: true },
  ]);
  // Waiting to try again: no estimate, no progress shown.
  f.client().emit('processing-progress', {
    recordingId: 'rec-1', owner: OWNER, percent: 12, etaSeconds: null,
  });
  assert.equal(f.events.filter(([n]) => n === 'recording-progress').length, 0);
  f.client().jobs = [
    { recordingId: 'rec-1', owner: OWNER, stage: 'uploaded', partial: false, partialReason: null, progress: { percent: 12, etaSeconds: null } },
  ];
  assert.equal((await f.recorder.recover())[0].progress, undefined);
  // Moving again: a measured estimate brings the bar back.
  f.client().emit('processing-progress', {
    recordingId: 'rec-1', owner: OWNER, percent: 20, etaSeconds: 40,
  });
  assert.deepEqual(
    f.events.filter(([n]) => n === 'recording-progress').at(-1)[1].progress,
    0.2,
  );
});

test('Stop waits as long as the recorder may take to finish a long recording', () => {
  const { stopBudget } = require('../engine/videodb/local-recorder');
  assert.equal(stopBudget(60), 160000); // short: the recorder's 155 s floor and a margin
  assert.equal(stopBudget(3600), 940000); // an hour: 15 min + 30 s, and a margin
});
