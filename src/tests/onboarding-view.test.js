const test = require('node:test');
const assert = require('node:assert/strict');

const flow = { attempted: true, cleared: false, key: 'synthetic-key' };
test('setup shows the actionable sign-in failure instead of assuming a network outage', async () => {
  const { connect } = await import('../ui/onboarding/views.js');
  for (const [kind, message] of [
    [
      'credential-storage',
      'Your API key could not be saved. Check disk space and file permissions, then try again.',
    ],
    ['collection-ambiguous', 'More than one Bloom collection exists.'],
    ['timeout', 'The request took too long. Try again when connected.'],
  ]) {
    const html = connect(
      { account: { status: 'offline' }, problem: { kind, message } },
      flow,
    );
    assert(html.includes(message));
    assert(!html.includes('Check your connection.'));
    assert(!html.includes('Encrypted on this Mac'));
    assert(!html.includes(flow.key), 'key values are never inserted into HTML');
  }
});
test('setup escapes the problem message and retains a fallback for older state', async () => {
  const { connect } = await import('../ui/onboarding/views.js');
  const state = {
    account: { status: 'offline' },
    problem: { message: '<img src=x onerror=alert(1)>' },
  };
  assert(connect(state, flow).includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(
    connect({ account: state.account }, flow).includes(
      'Can’t reach VideoDB. Check your connection.',
    ),
  );
});

test('Connect leads with Sign in with VideoDB when the build can open a browser', async () => {
  const { connect } = await import('../ui/onboarding/views.js');
  const fresh = { attempted: false, cleared: false, key: '', browser: false, useKey: null };
  const draw = (account, extra = {}, f = fresh) =>
    connect({ browserSignIn: true, account, problem: null, ...extra }, f);

  const ready = draw({ status: 'signed-out' });
  assert.match(ready, /data-act="browser">Sign in with VideoDB</);
  assert.match(ready, /Use an API key instead/);
  assert.match(ready, /Create a VideoDB account/);
  assert.doesNotMatch(ready, /setup-key/, 'no key field until asked for');

  const waiting = draw({ status: 'checking' }, {}, { ...fresh, browser: true, attempted: true });
  assert.match(waiting, /Waiting for your browser…/);
  assert.match(waiting, /Open the page again/);
  assert.match(waiting, /data-act="cancel-sign-in">Cancel/);

  assert.match(draw({ status: 'checking' }), /Connecting…/, 'a saved sign-in being checked');
  assert.match(
    draw({ status: 'invalid', method: 'token' }),
    /Your sign-in ran out. Sign in again to keep recording./,
  );
  // A saved key that stopped working also leads with Sign in with VideoDB.
  const keyRanOut = draw({ status: 'invalid', method: 'key' });
  assert.match(keyRanOut, /Your saved key stopped working. Sign in again to keep recording./);
  assert.match(keyRanOut, /data-act="browser">Sign in with VideoDB</);
  assert.doesNotMatch(keyRanOut, /setup-key/);

  const browser = { ...fresh, browser: true, attempted: true };
  assert.match(
    draw({ status: 'signed-out' }, { problem: { kind: 'denied', message: 'Sign-in was cancelled in the browser.' } }, browser),
    /setup-message bad[^]*Sign-in was cancelled in the browser./,
  );
  assert.doesNotMatch(
    draw({ status: 'signed-out' }, { problem: { kind: 'cancelled', message: 'Sign-in was cancelled.' } }, browser),
    /setup-message/,
    'a cancel the person clicked is not explained back to them',
  );

  const keyed = draw({ status: 'signed-out' }, {}, { ...fresh, useKey: true });
  assert.match(keyed, /setup-key/);
  assert.match(keyed, /Sign in with VideoDB instead/);
  // A build that cannot open a browser keeps today's step exactly.
  const plain = connect({ account: { status: 'signed-out' }, problem: null }, fresh);
  assert.match(plain, /setup-key/);
  assert.doesNotMatch(plain, /Sign in with VideoDB/);
});
