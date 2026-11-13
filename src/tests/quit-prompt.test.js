const test = require('node:test');
const assert = require('node:assert/strict');
const { recordingQuitPrompt } = require('../main/quit-guard');

test('retained failed uploads do not describe an idle recorder as active', () => {
  for (const phase of ['idle', 'finished', 'processing-error']) {
    const prompt = recordingQuitPrompt({
      phase,
      pending: [{ status: 'failed' }],
    });
    assert.equal(prompt.message, 'A recording still needs attention');
    assert.equal(prompt.buttons[1], 'Quit Bloom');
    assert.match(prompt.detail, /keep any retained recording files/);
    assert.match(prompt.detail, /retry failed uploads/);
    assert.equal(prompt.cancelId, 0);
  }
});

test('capture and finalization retain the stop-and-quit warning', () => {
  for (const phase of [
    'starting',
    'recording',
    'paused',
    'stopping',
    'stopped',
    'saving',
  ]) {
    const prompt = recordingQuitPrompt({ phase, pending: [] });
    assert.equal(prompt.buttons[1], 'Stop and Quit');
    assert.match(prompt.detail, /confirm capture has stopped/);
    assert.equal(prompt.defaultId, 0);
    assert.equal(prompt.cancelId, 0);
  }
});

test('completed work quits without a warning; pending uploads still ask', () => {
  for (const phase of ['idle', 'finished']) {
    assert.equal(recordingQuitPrompt({ phase, pending: [] }), null);
    for (const status of ['waiting', 'uploading', 'failed'])
      assert.ok(recordingQuitPrompt({ phase, pending: [{ status }] }));
  }
  assert.ok(recordingQuitPrompt({ phase: 'processing-error', pending: [] }));
});

test('setup can reopen Bloom without asking unless capture or finalisation is under way', () => {
  const { restartsQuietly } = require('../main/quit-guard');
  // A retained failed upload does not stand in the way of applying a new permission.
  for (const phase of ['idle', 'finished', 'processing-error'])
    assert.equal(
      restartsQuietly({ phase, pending: [{ status: 'failed' }] }),
      true,
    );
  for (const phase of [
    'starting',
    'recording',
    'paused',
    'stopping',
    'stopped',
    'saving',
  ])
    assert.equal(restartsQuietly({ phase, pending: [] }), false);
});
