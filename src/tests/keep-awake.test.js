const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createKeepAwake } = require('../main/keep-awake');

test('the Mac is kept awake only while a file is being sent, and only once', () => {
  const started = new Set();
  let next = 1;
  const calls = [];
  const blocker = {
    start(type) {
      calls.push(['start', type]);
      started.add(next);
      return next++;
    },
    stop(id) {
      calls.push(['stop', id]);
      started.delete(id);
    },
    isStarted: (id) => started.has(id),
  };
  const keep = createKeepAwake({ blocker });
  const state = (jobStage, status = 'processing') => ({
    recordings: [{ status, jobStage }],
  });
  keep.observe(state('registering'));
  assert.deepEqual(calls, []);
  keep.observe(state('sending'));
  keep.observe(state('sending'));
  assert.deepEqual(calls, [['start', 'prevent-app-suspension']]);
  keep.observe(state('waiting-connection'));
  assert.deepEqual(calls.at(-1), ['stop', 1]);
  keep.observe(state('complete', 'ready'));
  assert.equal(calls.length, 2);
});
