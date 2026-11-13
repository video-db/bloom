const test = require('node:test');
const assert = require('node:assert/strict');
const {
  recordingQuitPrompt,
  quitsQuietly,
  settledWithin,
} = require('../main/quit-guard');

const record = (extra) => ({ sessionId: 's1', status: 'processing', ...extra });

test('a recording being processed or needing recovery never raises a question at quit', () => {
  for (const phase of ['idle', 'finished', 'processing-error']) {
    const state = {
      phase,
      sessionId: 's1',
      recordings: [record({ status: 'error' })],
    };
    assert.equal(recordingQuitPrompt(state), null);
    assert.equal(quitsQuietly(state), true);
  }
  // Stopped, and the file is on this Mac: processing is background work.
  const processing = {
    phase: 'saving',
    sessionId: 's1',
    recordings: [record({ recordingId: 'local-1' })],
  };
  assert.equal(recordingQuitPrompt(processing), null);
});

test('capture, and a file still being written, ask before quitting', () => {
  const asks = (state) => {
    const prompt = recordingQuitPrompt(state);
    assert.equal(prompt.buttons[1], 'Stop and Quit');
    assert.equal(prompt.defaultId, 0);
    assert.equal(prompt.cancelId, 0);
    assert.doesNotMatch(`${prompt.message} ${prompt.detail}`, /upload/i);
  };
  for (const phase of [
    'starting',
    'recording',
    'paused',
    'stopping',
    'stopped',
  ])
    asks({ phase, sessionId: 's1', recordings: [record()] });
  asks({ phase: 'saving', sessionId: 's1', recordings: [record()] }); // no recorder id yet
});

test('a recorder shutdown that never returns cannot hold up quitting', async () => {
  const started = Date.now();
  await settledWithin(new Promise(() => {}), 40); // never settles
  assert.ok(Date.now() - started < 1000);
  await settledWithin(Promise.reject(new Error('recorder failed')), 40); // a failure is not thrown
  const quick = Date.now();
  await settledWithin(Promise.resolve(), 5000); // a prompt answer is not delayed
  assert.ok(Date.now() - quick < 500);
});
