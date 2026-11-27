// Where the floating control may sit so that it is not in the recording, and where the
// camera picture goes so that it is.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  safeDisplay,
  cameraDisplay,
  placeOn,
  whole,
} = require('../main/float-placement');

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

test('the camera picture goes on the display being recorded, bottom left', () => {
  assert.equal(
    cameraDisplay(recording({ screen: 'display:2' }), two, two[0]),
    two[1],
  );
  assert.equal(
    cameraDisplay(recording({ screen: 'display:77' }), two, two[0]),
    two[0],
    'an unknown display falls back to the main one',
  );
  assert.equal(
    cameraDisplay(
      recording({ screen: 'display:2', window: 'window:a' }),
      two,
      two[0],
    ),
    two[0],
    'a window recording has no display of its own',
  );
  assert.equal(cameraDisplay(recording({}), [], null), null);
  const size = { width: 200, height: 200 };
  assert.deepEqual(placeOn(two[1], size, { x: -1, y: -1 }, true), {
    x: 1464,
    y: 676,
  });
  assert.deepEqual(
    placeOn(two[0], size, { x: 300.4, y: 200.6 }, true),
    { x: 300, y: 201 },
    'where it was dragged to, in whole pixels',
  );
});

test('a window position is always a plain whole number', () => {
  // Electron refuses negative zero, fractions, NaN and numbers out of range.
  for (const [given, wanted] of [
    [-0.3, 0],
    [-0, 0],
    [0.5, 1],
    [-3.6, -4],
    [NaN, 0],
    [undefined, 0],
    [1e12, 100000],
    [-Infinity, -100000],
  ]) {
    const got = whole(given);
    assert.ok(Object.is(got, wanted), `${given} gave ${got}`);
  }
  // Dragged against the left and top edges of the first display.
  const at = placeOn(
    { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } },
    { width: 200, height: 200 },
    { x: -0, y: -0 },
    true,
  );
  assert.ok(Object.is(at.x, 0) && Object.is(at.y, 0));
});
