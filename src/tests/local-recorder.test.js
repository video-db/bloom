// The standalone recorder adapter against a fake SDK client and a fake service: what it
// tells the engine, what it keeps on disk, and what it never lets out (file paths).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createLocalRecorder } = require('../engine/videodb/local-recorder');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ journalFile, scopeId = 'a'.repeat(64) } = {}) {
  const calls = [];
  const uploads = []; // one deferred per upload attempt
  let serial = 0;
  let stopError = null;
  class Client extends EventEmitter {
    constructor(options) {
      super();
      assert.equal(
        options,
        undefined,
        'standalone capture takes no credentials',
      );
      calls.push(['construct']);
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
    async startLocalRecording(options) {
      calls.push(['start', options]);
      return { recordingId: `rec-${++serial}`, mode: 'deferred' };
    }
    async stopLocalRecording() {
      calls.push(['stop']);
      if (stopError) {
        const error = stopError;
        stopError = null;
        throw error;
      }
      return {
        recordingId: `rec-${serial}`,
        path: `/private/media/rec-${serial}.mp4`,
        durationSeconds: 12.5,
      };
    }
    async pauseTracks(tracks) {
      calls.push(['pause', tracks]);
    }
    async resumeTracks(tracks) {
      calls.push(['resume', tracks]);
    }
    async shutdown() {
      calls.push(['shutdown']);
    }
  }
  const service = {
    scopeId,
    cachedIdentity: () =>
      service.scopeId ? { scopeId: service.scopeId } : null,
    uploadRecording: (file) =>
      new Promise((resolve, reject) => uploads.push({ file, resolve, reject })),
  };
  const recorder = createLocalRecorder({
    CaptureClient: Client,
    service,
    journalFile,
    permissionStatus: () => true,
  });
  const events = [];
  recorder.onEvent((name, payload) => events.push([name, payload]));
  return {
    recorder,
    service,
    calls,
    uploads,
    events,
    failStop(error) {
      stopError = error;
    },
  };
}
const tempJournal = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-local-recorder-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'local-recordings.json');
};
const channels = [
  { channelId: 'display:1', type: 'video', isPrimary: true, store: false },
  { channelId: 'mic:default', type: 'audio', store: false },
];

test('recording needs no session or token; only the default sound sources are offered', async () => {
  const f = fixture();
  const found = await f.recorder.channels();
  assert.deepEqual(found.mics, [{ id: 'mic:default', name: 'Microphone' }]);
  assert.deepEqual(found.displays, [
    { id: 'display:1', name: 'Built-in display' },
  ]);
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  assert.deepEqual(f.calls.find(([name]) => name === 'start')[1], {
    channels: [
      { channelId: 'display:1', type: 'video' },
      { channelId: 'mic:default', type: 'audio' },
    ],
  });
});

test('Stop finalises the file, says so, sends it, and reports completion without a path', async (t) => {
  const journalFile = tempJournal(t);
  const f = fixture({ journalFile });
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.stop();
  assert.deepEqual(f.events[0], [
    'local-recording-ready',
    {
      recordingId: 'rec-1',
      sessionId: 'rec-a',
      stage: 'processing',
      metadata: { duration_seconds: 12.5 },
    },
  ]);
  assert.deepEqual(f.uploads[0].file, {
    path: '/private/media/rec-1.mp4',
    title: 'Demo',
  });
  const waiting = f.recorder.wait({ sessionId: 'rec-a' });
  f.uploads[0].resolve({ id: 'm-1' });
  assert.deepEqual(await waiting, {
    recordingId: 'rec-1',
    sessionId: 'rec-a',
    result: { videoId: 'm-1' },
  });
  assert.equal(f.events.at(-1)[0], 'processing-complete');
  assert.equal(f.uploads.length, 1, 'waiting did not send it a second time');
  // Nothing the engine sees carries the file's location.
  assert.doesNotMatch(JSON.stringify(f.events), /private\/media/);
  assert.doesNotMatch(
    JSON.stringify(await f.recorder.recover()),
    /private\/media/,
  );
  assert.match(
    fs.readFileSync(journalFile, 'utf8'),
    /private\/media\/rec-1\.mp4/,
  );
});

test('a failed send is reported, and Recover sends the same file again', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.stop();
  f.uploads[0].reject(new Error('network'));
  await flush();
  assert.deepEqual(f.events.at(-1), [
    'recording-relay-failed',
    { recordingId: 'rec-1', sessionId: 'rec-a' },
  ]);
  assert.equal((await f.recorder.recover())[0].stage, 'failed');
  await assert.rejects(f.recorder.wait({ recordingId: 'rec-1' }));

  await f.recorder.relay('rec-1');
  assert.equal(f.uploads.length, 2);
  assert.equal(f.uploads[1].file.path, '/private/media/rec-1.mp4');
  f.uploads[1].resolve({ id: 'm-2' });
  await flush();
  assert.deepEqual((await f.recorder.recover())[0], {
    recordingId: 'rec-1',
    sessionId: 'rec-a',
    stage: 'complete',
    result: { videoId: 'm-2' },
  });
  await assert.rejects(f.recorder.relay('made-by-an-older-bloom'), {
    code: 'not-found',
  });
});

test('after a restart an unfinished file is found again and sent, for its own account only', async (t) => {
  const journalFile = tempJournal(t);
  const first = fixture({ journalFile });
  await first.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await first.recorder.stop(); // quit before the send finished

  const second = fixture({ journalFile });
  assert.deepEqual(await second.recorder.recover(), [
    { recordingId: 'rec-1', sessionId: 'rec-a', stage: 'processing' },
  ]);
  const waiting = second.recorder.wait({ recordingId: 'rec-1' });
  assert.equal(second.uploads.length, 1, 'waiting for it starts sending it');
  second.uploads[0].resolve({ id: 'm-9' });
  assert.equal((await waiting).result.videoId, 'm-9');

  const other = fixture({ journalFile, scopeId: 'b'.repeat(64) });
  assert.deepEqual(
    await other.recorder.recover(),
    [],
    'another account sees none of it',
  );
});

test('a recording still being captured waits for its file, and pause reaches the recorder', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.pause(['screen', 'mic']);
  await f.recorder.resume(['screen', 'mic']);
  assert.deepEqual(
    f.calls.filter(([name]) => ['pause', 'resume'].includes(name)),
    [
      ['pause', ['screen', 'mic']],
      ['resume', ['screen', 'mic']],
    ],
  );
  let settled = false;
  const waiting = f.recorder.wait({ sessionId: 'rec-a' }).then((payload) => {
    settled = true;
    return payload;
  });
  await flush();
  assert.equal(settled, false);
  assert.equal(f.uploads.length, 0, 'nothing is sent before Stop has the file');
  await f.recorder.stop();
  f.uploads[0].resolve({ id: 'm-3' });
  assert.equal((await waiting).result.videoId, 'm-3');
});

// Found in review on 14 Nov: states a recording could be stuck in.
test('a capture that ended but could not be finished is a failed recording, not a stuck Stop', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  f.failStop(
    Object.assign(new Error('Finalization failed; output retained'), {
      code: 'FINALIZE_FAILED',
    }),
  );
  await f.recorder.stop(); // does not throw: capture is over
  assert.equal((await f.recorder.recover())[0].stage, 'failed');
  await assert.rejects(f.recorder.wait({ sessionId: 'rec-a' }));
  await assert.rejects(
    f.recorder
      .relay('rec-1')
      .then(() => f.recorder.wait({ recordingId: 'rec-1' })),
  );
  assert.equal(f.uploads.length, 0, 'there is no file to send');
});

test('a Stop that may not have reached the recorder still throws, so it can be tried again', async () => {
  const f = fixture();
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  f.failStop(new Error('Command timeout'));
  await assert.rejects(f.recorder.stop());
  await f.recorder.stop(); // the second try reaches the recorder
  assert.equal(f.events.at(-1)[0], 'local-recording-ready');
});

test('a capture cut short by a crash is failed at the next launch, not processing forever', async (t) => {
  const journalFile = tempJournal(t);
  const first = fixture({ journalFile });
  await first.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  // Bloom dies here: no Stop, no file.
  const second = fixture({ journalFile });
  assert.equal((await second.recorder.recover())[0].stage, 'failed');
  await assert.rejects(second.recorder.wait({ recordingId: 'rec-1' }));
});

test('quitting while capturing finishes the file first, and no account means no recording', async (t) => {
  const journalFile = tempJournal(t);
  const f = fixture({ journalFile });
  await f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await f.recorder.shutdown();
  assert.deepEqual(
    f.calls.slice(-2).map(([name]) => name),
    ['stop', 'shutdown'],
  );
  assert.match(
    fs.readFileSync(journalFile, 'utf8'),
    /"path":"\/private\/media\/rec-1\.mp4"/,
  );

  const signedOut = fixture();
  signedOut.service.scopeId = null;
  await assert.rejects(
    signedOut.recorder.start({ sessionId: 'rec-b', channels, title: 'Demo' }),
    { code: 'signed-out' },
  );
});
