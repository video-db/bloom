const test = require('node:test');
const assert = require('node:assert/strict');
const { createLinuxUpdater } = require('../main/linux-updater');

function fixture(next) {
  const calls = [];
  const state = { phase: 'recording' };
  const updater = createLinuxUpdater({
    version: '2.4.0-linux.preview.3',
    getState: () => state,
    quit: () => calls.push('quit'),
    relaunch: () => calls.push('relaunch'),
    resourcesPath: '/opt/Bloom/resources',
    fetchImpl: async () => ({ ok: true, text: async () => next }),
    command: async (...args) => { calls.push(args); },
  });
  return { calls, state, updater };
}
test('hosted update restarts only after capture and invokes the packaged verifier', async () => {
  const next = '2.4.0-linux.preview.4';
  const { updater, state, calls } = fixture(next);
  const first = updater.checkNow();
  assert.equal(updater.checkNow(), first);
  await first;
  assert.equal(updater.shown().state, 'ready');
  assert.equal(updater.installNow(), false);
  state.phase = 'idle';
  assert.equal(updater.installNow(), true);
  await updater.applyOnQuit({ reopen: false });
  assert.deepEqual(calls.slice(1), [
    'quit', ['/usr/bin/pkexec', ['/opt/Bloom/resources/install-linux', next]], 'relaunch',
  ]);
});
test('current version and invalid pointers never offer an install', async () => {
  for (const [pointer, status] of [['2.4.0-linux.preview.3', 'current'], ['../../other', 'failed']]) {
    const { updater } = fixture(pointer);
    await updater.checkNow();
    assert.equal(updater.shown().state, status);
    assert.equal(updater.hasUpdate(), false);
  }
});
