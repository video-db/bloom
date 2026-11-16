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

function fixture({
  journalFile,
  scopeId = 'a'.repeat(64),
  recorderHome = '/nowhere',
} = {}) {
  const calls = [];
  const uploads = []; // one deferred per upload attempt
  let serial = 0;
  let stopError = null;
  let startError = null;
  let stopFiles = (folder) => [`${folder}/recording.mp4`];
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
    async startLocalRecording(options) {
      calls.push(['start', options]);
      if (startError) {
        const error = startError;
        startError = null;
        throw error;
      }
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
        // As the real recorder answers: the recording's folder, and the files in it.
        path: `/private/media/rec-${serial}`,
        files: stopFiles(`/private/media/rec-${serial}`),
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
    recorderHome,
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
    failStart(error) {
      startError = error;
    },
    // What the recorder says its folder holds, when a test needs another answer.
    stopFiles(list) {
      stopFiles = list;
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
    path: '/private/media/rec-1/recording.mp4',
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
    /private\/media\/rec-1\/recording\.mp4/,
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
  assert.equal(f.uploads[1].file.path, '/private/media/rec-1/recording.mp4');
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

test('what is sent is the video in the recording folder, however the recorder names it', async (t) => {
  // File names relative to the folder.
  const named = fixture();
  named.stopFiles(() => ['media.json', 'recording.mp4']);
  await named.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' });
  await named.recorder.stop();
  assert.equal(
    named.uploads[0].file.path,
    path.join('/private/media/rec-1', 'recording.mp4'),
  );

  // No list at all, and a list kept by an earlier Bloom that stored the folder: the folder
  // is looked into. Recover then sends the video, not the folder.
  const journalFile = tempJournal(t);
  const folder = path.join(path.dirname(journalFile), 'rec-old');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'media.json'), '{}');
  fs.writeFileSync(path.join(folder, 'recording.mp4'), 'video');
  fs.writeFileSync(
    journalFile,
    JSON.stringify({
      version: 1,
      entries: {
        'rec-old': {
          sessionId: 'rec-b',
          scopeId: 'a'.repeat(64),
          title: 'Kept',
          stage: 'failed',
          path: folder,
        },
      },
    }),
  );
  const later = fixture({ journalFile });
  later.recorder.relay('rec-old').catch(() => {});
  await flush();
  assert.equal(later.uploads[0].file.path, path.join(folder, 'recording.mp4'));
  later.uploads[0].resolve({ id: 'm-9' });
  await flush();
  assert.equal(
    JSON.parse(fs.readFileSync(journalFile, 'utf8')).entries['rec-old'].path,
    path.join(folder, 'recording.mp4'),
  );

  // A folder with no video in it is never sent: the recording needs recovery instead.
  const empty = fixture();
  empty.stopFiles(() => []);
  await empty.recorder.start({ sessionId: 'rec-c', channels, title: 'Demo' });
  await empty.recorder.stop();
  await flush();
  assert.equal(empty.uploads.length, 0);
  assert.equal(empty.events.at(-1)[0], 'recording-relay-failed');
});

test('a recording that is ready in VideoDB has its file deleted, and nothing else is', async (t) => {
  const journalFile = tempJournal(t);
  const dir = path.dirname(journalFile);
  // As the recorder keeps them: a folder named by the recording's id.
  const folder = (id) => {
    const at = path.join(dir, 'recordings', id);
    fs.mkdirSync(at, { recursive: true });
    fs.writeFileSync(path.join(at, 'recording.mp4'), 'video');
    fs.writeFileSync(path.join(at, 'media.json'), '{}');
    return at;
  };
  const sent = folder('rec-sent');
  const failed = folder('rec-failed');
  const capturing = folder('rec-capturing');
  // A video kept somewhere that is not the recorder's own folder for it.
  const elsewhere = path.join(dir, 'Movies');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'mine.mp4'), 'video');
  fs.writeFileSync(path.join(elsewhere, 'holiday.mov'), 'not ours');
  const entry = (extra) => ({
    sessionId: 's',
    scopeId: 'a'.repeat(64),
    title: 'Demo',
    ...extra,
  });
  fs.writeFileSync(
    journalFile,
    JSON.stringify({
      version: 1,
      entries: {
        'rec-sent': entry({ stage: 'complete', videoId: 'm-1', path: sent }),
        'rec-failed': entry({ stage: 'failed', path: failed }),
        'rec-capturing': entry({ stage: 'ready', path: capturing }),
        'rec-elsewhere': entry({
          stage: 'complete',
          videoId: 'm-2',
          path: path.join(elsewhere, 'mine.mp4'),
        }),
        'rec-nolink': entry({ stage: 'complete', path: sent }),
      },
    }),
  );
  const f = fixture({ journalFile });
  const known = () =>
    Object.keys(JSON.parse(fs.readFileSync(journalFile, 'utf8')).entries);

  // Sent and confirmed: its folder goes, and it is forgotten.
  assert.equal(f.recorder.discard('rec-sent'), true);
  assert.equal(fs.existsSync(sent), false);
  assert.equal(known().includes('rec-sent'), false);
  // Not finished, or failed: kept, so Recover has something to send.
  assert.equal(f.recorder.discard('rec-failed'), false);
  assert.equal(f.recorder.discard('rec-capturing'), false);
  assert.equal(
    f.recorder.discard('rec-nolink'),
    false,
    'no video id, no delete',
  );
  assert.equal(fs.existsSync(path.join(failed, 'recording.mp4')), true);
  assert.equal(fs.existsSync(path.join(capturing, 'recording.mp4')), true);
  // Not in the recorder's own folder: only the video file itself is removed.
  assert.equal(f.recorder.discard('rec-elsewhere'), true);
  assert.equal(fs.existsSync(path.join(elsewhere, 'mine.mp4')), false);
  assert.equal(fs.existsSync(path.join(elsewhere, 'holiday.mov')), true);
  // Unknown, or already gone: nothing to do, and that is fine.
  assert.equal(f.recorder.discard('rec-sent'), true);
  assert.equal(f.recorder.discard('never-heard-of-it'), true);
  assert.deepEqual(known().sort(), [
    'rec-capturing',
    'rec-failed',
    'rec-nolink',
  ]);
});

// What the SDK throws when the recorder answers a command with a failure.
const refusal = (code, message = 'Recorder command failed') =>
  Object.assign(new Error(message), { name: 'CaptureCommandError', code });

test('a Start the recorder refuses is a plain no; a Stop with nothing recording has nothing to wait for', async () => {
  const f = fixture();
  f.failStart(refusal('NATIVE_START_FAILED'));
  await assert.rejects(
    f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' }),
    (error) => error.refused === true && error.code === 'recorder-refused',
  );
  assert.deepEqual(await f.recorder.recover(), [], 'no recording was begun');
  // A window that has gone is said as such.
  f.failStart(refusal('TARGET_NOT_FOUND'));
  await assert.rejects(
    f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' }),
    /no longer available/,
  );
  // No answer at all is different: capture may have begun, so it is not a refusal.
  f.failStart(new Error('socket closed'));
  await assert.rejects(
    f.recorder.start({ sessionId: 'rec-a', channels, title: 'Demo' }),
    (error) => !error.refused,
  );
  // Stop, when the recorder says nothing is being recorded and Bloom knew of nothing.
  f.failStop(refusal('NOT_RECORDING', 'No standalone recording is active'));
  assert.deepEqual(await f.recorder.stop(), { nothing: true });
});

test('Recover never sends a finished recording again, and finds one whose Stop never answered', async (t) => {
  const journalFile = tempJournal(t);
  const home = path.join(path.dirname(journalFile), 'recordings');
  const keep = (id, media) => {
    const at = path.join(home, id);
    fs.mkdirSync(at, { recursive: true });
    fs.writeFileSync(path.join(at, 'recording.mp4'), 'video');
    fs.writeFileSync(path.join(at, 'media.json'), JSON.stringify(media));
    return at;
  };
  keep('rec-finished', { complete: true });
  keep('rec-cut-short', { complete: false });
  const entry = (extra) => ({
    sessionId: 's',
    scopeId: 'a'.repeat(64),
    title: 'Demo',
    ...extra,
  });
  fs.writeFileSync(
    journalFile,
    JSON.stringify({
      version: 1,
      entries: {
        'rec-done': entry({
          stage: 'complete',
          videoId: 'm-1',
          path: '/x/y.mp4',
        }),
        // Being made when Bloom closed: no file was ever written down.
        'rec-finished': entry({ stage: 'recording' }),
        'rec-cut-short': entry({ stage: 'recording' }),
      },
    }),
  );
  const f = fixture({ journalFile, recorderHome: home });
  // Already in VideoDB: said again, nothing sent.
  await f.recorder.relay('rec-done');
  assert.equal(f.uploads.length, 0);
  assert.deepEqual(f.events.at(-1), [
    'processing-complete',
    { recordingId: 'rec-done', sessionId: 's', result: { videoId: 'm-1' } },
  ]);
  // The recorder had finished this one all the same: it is found and sent.
  await f.recorder.relay('rec-finished');
  await flush();
  assert.equal(
    f.uploads[0].file.path,
    path.join(home, 'rec-finished', 'recording.mp4'),
  );
  // A file the recorder never finished is not sent as if it were whole.
  await f.recorder.relay('rec-cut-short');
  await flush();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.events.at(-1)[0], 'recording-relay-failed');
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
    /"path":"\/private\/media\/rec-1\/recording\.mp4"/,
  );

  const signedOut = fixture();
  signedOut.service.scopeId = null;
  await assert.rejects(
    signedOut.recorder.start({ sessionId: 'rec-b', channels, title: 'Demo' }),
    { code: 'signed-out' },
  );
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
