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
