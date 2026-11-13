// Where the floating control may sit so that it is not in the recording.
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeDisplay, placeOn } = require('../main/float-placement');

const display = (id, x = 0) => ({
  id,
  workArea: { x, y: 25, width: 1440, height: 875 },
});
const one = [display(1)];
const two = [display(1), display(2, 1440)];
const recording = (sources) => ({
  sources: { screen: '', window: '', ...sources },
});

test('a window recording can have the control anywhere', () => {
  assert.equal(
    safeDisplay(recording({ window: 'window:a' }), one, one[0]),
    one[0],
  );
});

test('a display recording has it only on another display', () => {
  assert.equal(
    safeDisplay(recording({ screen: 'display:1' }), two, two[0]),
    two[1],
  );
  assert.equal(
    safeDisplay(recording({ screen: 'display:2' }), two, two[0]),
    two[0],
  );
  assert.equal(
    safeDisplay(recording({ screen: 'display:1' }), one, one[0]),
    null,
    'one display, and it is being recorded: nowhere is safe',
  );
});

test('when the recorded display cannot be identified, the control is not shown', () => {
  assert.equal(
    safeDisplay(recording({ screen: 'display:77' }), two, two[0]),
    null,
  );
  assert.equal(safeDisplay(recording({ screen: '' }), two, two[0]), null);
  assert.equal(safeDisplay(recording({ window: 'window:a' }), [], null), null);
});

test('it opens on the left edge at mid-height, or where it was last put on that display', () => {
  const size = { width: 56, height: 220 };
  assert.deepEqual(placeOn(two[0], size, { x: -1, y: -1 }), { x: 16, y: 353 });
  assert.deepEqual(placeOn(two[0], size, { x: 700, y: 300 }), {
    x: 700,
    y: 300,
  });
  assert.deepEqual(
    placeOn(two[1], size, { x: 700, y: 300 }),
    { x: 1456, y: 353 },
    'a saved spot on the other display is not used',
  );
});
