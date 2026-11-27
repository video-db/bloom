// Starting after an update: Bloom clears its own stale Screen Recording entry only when it
// was updated, is installed, and can no longer record the screen; setup then says why.
const test = require('node:test');
const assert = require('node:assert/strict');
const { afterUpdate } = require('../main/after-update');

const prefsWith = (values) => {
  const saved = { ...values };
  return {
    all: () => ({ ...saved }),
    set: (key, value) => (saved[key] = value),
  };
};
const run = (
  values,
  { packaged = true, screen = 'denied', version = '2.3.10' } = {},
) => {
  const prefs = prefsWith(values);
  let resets = 0;
  const updated = afterUpdate({
    version,
    prefs,
    packaged,
    screenStatus: () => screen,
    reset: () => resets++,
  });
  return { updated, resets, lastVersion: prefs.all().lastVersion };
};

test('after an update with Screen Recording gone, the stale entry is cleared once', () => {
  assert.deepEqual(run({ onboardingComplete: true, lastVersion: '2.3.9' }), {
    updated: true,
    resets: 1,
    lastVersion: '2.3.10',
  });
  // From a build that did not note its version: still an update, once setup was done.
  assert.equal(
    run({ onboardingComplete: true, lastVersion: '' }).updated,
    true,
  );
});

test('nothing is cleared when it is not needed', () => {
  // Same version as last time: a restart, not an update.
  assert.deepEqual(run({ onboardingComplete: true, lastVersion: '2.3.10' }), {
    updated: false,
    resets: 0,
    lastVersion: '2.3.10',
  });
  // Screen Recording still works after the update.
  assert.equal(
    run(
      { onboardingComplete: true, lastVersion: '2.3.9' },
      { screen: 'granted' },
    ).resets,
    0,
  );
  // First run: setup asks anyway, and there is nothing stale.
  const first = run({ onboardingComplete: false, lastVersion: '' });
  assert.equal(first.resets, 0);
  assert.equal(
    first.lastVersion,
    '2.3.10',
    'the version is noted for next time',
  );
  // From source: never touch the permissions of the installed app.
  assert.equal(
    run({ onboardingComplete: true, lastVersion: '2.3.9' }, { packaged: false })
      .resets,
    0,
  );
});

test('setup says why the permission is needed again, until it is on', async () => {
  const { permissions } = await import('../ui/onboarding/views.js');
  const flow = {
    screenAsked: false,
    screenReturned: false,
    micAsking: false,
    micDenied: false,
  };
  const state = (extra) => ({
    permissions: { screen: false, mic: true },
    recorder: { status: 'ready' },
    prefs: {},
    livePreviews: false,
    ...extra,
  });
  const notice = /Bloom has been updated\. Turn on Screen Recording again/;
  assert.match(permissions(state({ updated: true }), flow), notice);
  assert.doesNotMatch(permissions(state({ updated: false }), flow), notice);
  assert.doesNotMatch(
    permissions(
      state({ updated: true, permissions: { screen: true, mic: true } }),
      flow,
    ),
    notice,
    'gone once Screen Recording is on',
  );
});
