// Search against the shapes VideoDB really returns, including how it says "nothing found".
const test = require('node:test');
const assert = require('node:assert/strict');
const { createExplore } = require('../engine/videodb/explore');

const exploreWith = (legacySearch) => {
  const scope = { conn: {}, collection: { id: 'c-1', legacySearch } };
  return createExplore({
    account: () => scope,
    read: (_scope, work) => work(),
  });
};

test('VideoDB’s "No results found" error is an empty result, not a failed search', async () => {
  const explore = exploreWith(async () => {
    throw new Error('VideoDB Error: No results found.');
  });
  assert.deepEqual(await explore.search('nothing like this'), []);
});

test('any other search failure is still a failure', async () => {
  const explore = exploreWith(async () => {
    throw new Error('VideoDB Error: Service unavailable');
  });
  await assert.rejects(explore.search('anything'), /Service unavailable/);
});

test('moments keep the recording, its times and the spoken text', async () => {
  const explore = exploreWith(async (query) => {
    assert.equal(query, 'curiosity');
    return {
      shots: [
        { videoId: 'm-1', start: 0, end: 38.99, text: ' Notice patterns. ' },
        { videoId: 'm-1', start: 50, end: 40, text: 'ends before it starts' },
      ],
    };
  });
  assert.deepEqual(await explore.search('  curiosity '), [
    { videoId: 'm-1', start: 0, end: 38.99, text: 'Notice patterns.' },
  ]);
});
