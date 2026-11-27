// Recordings in date order are grouped the way Finder names stretches of time.
const test = require('node:test');
const assert = require('node:assert/strict');

test('a recording falls under Today, Yesterday, a recent stretch, its month or its year', async () => {
  const { period } = await import('../ui/workspace/format.js');
  const now = new Date(2026, 10, 16, 15, 30).getTime(); // 16 Nov 2026, afternoon
  const at = (...date) => new Date(...date).getTime();
  for (const [when, group] of [
    [at(2026, 10, 16, 0, 5), 'Today'],
    [at(2026, 10, 16, 23, 0), 'Today'], // later the same day
    [at(2026, 10, 15, 23, 59), 'Yesterday'],
    [at(2026, 10, 14, 9, 0), 'Previous 7 Days'],
    [at(2026, 10, 9, 0, 0), 'Previous 7 Days'],
    [at(2026, 10, 8, 23, 0), 'Previous 30 Days'],
    [at(2026, 9, 17, 12, 0), 'Previous 30 Days'],
    [at(2025, 11, 31, 12, 0), '2025'],
    [0, 'Earlier'],
    [undefined, 'Earlier'],
  ])
    assert.equal(period(when, now), group, String(new Date(when)));
  // Further back in the same year: the month's name, in the reader's language.
  assert.equal(
    period(at(2026, 2, 3), now),
    new Date(2026, 2, 3).toLocaleDateString(undefined, { month: 'long' }),
  );
});

test('date order shows groups; other orders are one plain grid', async () => {
  const { recordings } = await import('../ui/workspace/recordings.js');
  const day = 24 * 60 * 60 * 1000;
  const record = (id, ago, title) => ({
    id,
    title,
    duration: 60,
    status: 'ready',
    createdAt: Date.now() - ago,
    marks: [],
  });
  const s = {
    browsing: null,
    recordings: [
      record('a', 0, 'Zebra'),
      record('b', 3 * day, 'Apple'),
      record('c', 3 * day + 1000, 'Mango'),
    ],
  };
  const dated = recordings(s, { filter: 'all', order: 'newest' });
  assert.deepEqual(
    [...dated.matchAll(/<h2 class="label">([^<]+)<\/h2>/g)].map((m) => m[1]),
    ['Today', 'Previous 7 Days'],
  );
  assert.equal(dated.match(/class="tiles"/g).length, 2);
  const named = recordings(s, { filter: 'all', order: 'name' });
  assert.equal(named.match(/class="tiles"/g).length, 1);
  assert.equal(named.includes('tile-group'), false);
});

test('a recording being made says Recording, with no 0:00 length', async () => {
  const { status, meta } = await import('../ui/workspace/format.js');
  const capturing = {
    status: 'processing',
    jobStage: 'recording',
    duration: 0,
    createdAt: Date.parse('2026-11-19T02:11:00'),
  };
  assert.equal(status(capturing), 'Recording');
  assert.doesNotMatch(meta(capturing), /0:00/);
  // Once stopped it is processed, with its length.
  const stopped = { ...capturing, jobStage: 'sending', progress: 0.4, duration: 64 };
  assert.equal(status(stopped), 'Processing 40%');
  assert.match(meta(stopped), /1:04/);
});
