// Sign-in, reachability, the staged save after Stop, uploads left over from an earlier
// session, capabilities, and the question asked before quitting during an upload.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSampleEngine } = require('../engine/sample');
const { capabilitiesFor } = require('../engine/capabilities');
const { createQuitGuard } = require('../main/quit-guard');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withEngine = async (options, run) => {
  const engine = createSampleEngine(options);
  try {
    await run(engine);
  } finally {
    engine.dispose();
  }
};

test('a key is checked, never stored, and a signed-out app cannot start a recording', () =>
  withEngine({ signedIn: false }, async (e) => {
    assert.equal(e.getState().account.status, 'signed-out');
    e.command('start');
    assert.equal(e.getState().phase, 'idle');

    e.command('signIn', { key: 'short' });
    assert.equal(e.getState().account.status, 'checking');
    await wait(750);
    assert.equal(e.getState().account.status, 'invalid');

    e.command('signIn', { key: 'offline-key-0123456789' });
    await wait(750);
    assert.equal(e.getState().account.status, 'offline');

    const key = 'sk-sample-0123456789abcdef';
    e.command('signIn', { key });
    await wait(750);
    assert.equal(e.getState().account.status, 'signed-in');
    assert(
      !JSON.stringify(e.getState()).includes(key),
      'the key must not be in state',
    );

    e.command('start');
    assert.equal(e.getState().phase, 'starting');
    e.command('signOut');
    assert.equal(
      e.getState().account.status,
      'signed-in',
      'no sign-out mid-session',
    );
    e.command('cancel');
    e.command('signOut');
    assert.equal(e.getState().account.status, 'signed-out');
  }));

test('sign-in survives a new session and rejects malformed keys', () =>
  withEngine({}, async (e) => {
    assert.equal(e.command('signIn', { key: 42 }), false);
    assert.equal(e.command('signIn', { key: 'x'.repeat(201) }), false);
    e.command('start');
    await wait(1300);
    e.command('stop');
    await wait(1900);
    e.command('newRecording');
    assert.equal(e.getState().account.status, 'signed-in');
  }));

test('offline blocks Start with a stated problem until the connection is checked', () =>
  withEngine({}, async (e) => {
    e.command('simulate', { kind: 'offline' });
    assert.deepEqual(e.getState().problem, { kind: 'offline' });
    e.command('start');
    assert.equal(e.getState().phase, 'idle');
    assert.deepEqual(e.getState().problem, { kind: 'offline' });
    e.command('checkConnection');
    assert.equal(e.getState().problem, null);
    e.command('start');
    assert.equal(e.getState().phase, 'starting');
  }));

test('saving reports finalising, uploading with progress, then processing, in that order', () =>
  withEngine({}, async (e) => {
    const seen = [];
    e.onState((s) => {
      if (s.phase !== 'saving' || !s.upload) return;
      const step = `${s.upload.stage}:${s.upload.progress}`;
      if (seen.at(-1) !== step) seen.push(step);
    });
    e.command('start');
    await wait(1300);
    e.command('stop');
    assert.deepEqual(e.getState().upload, { stage: 'finalizing', progress: 0 });
    await wait(1900);
    assert.equal(e.getState().phase, 'finished');
    assert.equal(e.getState().upload, null);
    assert.equal(seen[0], 'finalizing:0');
    assert.equal(seen.at(-1), 'processing:1');
    const uploading = seen
      .filter((step) => step.startsWith('uploading:'))
      .map((step) => Number(step.split(':')[1]));
    assert(uploading.length >= 3, 'progress is reported more than once');
    assert.deepEqual(
      uploading,
      [...uploading].sort((a, b) => a - b),
      'progress never goes back',
    );
    assert.equal(uploading.at(-1), 1);
  }));

test('an upload left by an earlier session resumes, survives a new session and becomes a recording', () =>
  withEngine({}, async (e) => {
    e.command('simulate', { kind: 'pending-upload' });
    const [upload] = e.getState().pending;
    assert.equal(upload.status, 'waiting');
    const before = e.getState().recordings.length;

    e.command('start');
    await wait(1300);
    assert.equal(
      e.getState().pending.length,
      1,
      'a new session keeps pending uploads',
    );
    e.command('stop');
    await wait(1900);
    e.command('newRecording');
    assert.equal(e.getState().pending.length, 1);

    e.command('resumeUpload', { id: upload.id });
    assert.equal(e.getState().pending[0].status, 'uploading');
    e.command('discardUpload', { id: upload.id });
    assert.equal(
      e.getState().pending.length,
      1,
      'an upload in flight cannot be discarded',
    );
    await wait(1000);
    assert.equal(e.getState().pending.length, 0);
    assert.equal(e.getState().recordings.length, before + 2);
    assert.equal(e.getState().recordings[0].id, upload.id);
    await wait(1300);
    assert.equal(e.getState().recordings[0].status, 'ready');
  }));

test('the first-release scope reports no unbuilt capability, and no scope offers camera', () => {
  assert(
    Object.values(capabilitiesFor('v1')).every((value) => value === false),
  );
  assert.equal(capabilitiesFor('full').editing, true);
  assert.equal(capabilitiesFor('full').camera, false);
  assert.deepEqual(capabilitiesFor('unknown'), capabilitiesFor('full'));
  const engine = createSampleEngine({ scope: 'v1' });
  try {
    assert.equal(engine.getState().capabilities.editing, false);
  } finally {
    engine.dispose();
  }
});

test('quitting is questioned only while a recording is being saved or uploaded, and only once', () => {
  let state = { phase: 'idle', pending: [] };
  const asked = [];
  let answer = 0;
  const guard = createQuitGuard({
    engine: { getState: () => state },
    ask: (options) => {
      asked.push(options.message);
      return answer;
    },
  });
  assert.equal(guard.allows(), true);
  assert.equal(asked.length, 0);

  state = { phase: 'saving', pending: [] };
  assert.equal(guard.allows(), false, 'Keep Bloom Open cancels the quit');
  state = { phase: 'idle', pending: [{ status: 'uploading' }] };
  assert.equal(guard.allows(), false);
  assert.equal(asked.length, 2);

  answer = 1;
  assert.equal(guard.allows(), true, 'Quit Anyway lets it through');
  assert.equal(guard.allows(), true);
  assert.equal(asked.length, 3, 'not asked again after confirming');
});
