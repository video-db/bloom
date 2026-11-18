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

test('while recording the display stays on, and is let go once the recording has stopped', () => {
  const started = new Map();
  let next = 1;
  const blocker = {
    start(type) {
      started.set(next, type);
      return next++;
    },
    stop(id) {
      started.delete(id);
    },
    isStarted: (id) => started.has(id),
  };
  const keep = createKeepAwake({ blocker });
  const held = () => [...started.values()].sort();
  keep.observe({ phase: 'idle', recordings: [] });
  assert.deepEqual(held(), []);
  keep.observe({ phase: 'recording', recordings: [] });
  keep.observe({ phase: 'paused', recordings: [] });
  assert.deepEqual(held(), ['prevent-display-sleep']);
  // Stopped and being sent: the display may sleep, the Mac may not.
  keep.observe({
    phase: 'saving',
    recordings: [{ status: 'processing', jobStage: 'sending' }],
  });
  assert.deepEqual(held(), ['prevent-app-suspension']);
  keep.observe({ phase: 'finished', recordings: [{ status: 'ready' }] });
  assert.deepEqual(held(), []);
});
