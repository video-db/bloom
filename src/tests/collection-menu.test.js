const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectionMenu } = require('../main/collection-menu');

test('collection menus protect the destination and offer recovery instead of replaying a mutation', () => {
  const events = [];
  const menu = collectionMenu({ bloom: false }, (action) =>
    events.push(action),
  );
  menu.find((item) => item.label === 'Rename…').click();
  menu.find((item) => item.label === 'Delete collection…').click();
  assert.deepEqual(events, ['rename', 'delete']);
  for (const collection of [
    { bloom: true },
    { pendingOperation: { kind: 'rename' } },
  ]) {
    const guarded = collectionMenu(collection, () => {});
    assert.equal(
      guarded.find((item) => item.label === 'Rename…').enabled,
      false,
    );
    assert.equal(
      guarded.find((item) => item.label === 'Delete collection…').enabled,
      false,
    );
  }
  assert(
    collectionMenu({ pendingOperation: {} }, () => {}).some(
      (item) => item.label === 'Check previous change',
    ),
  );
});
