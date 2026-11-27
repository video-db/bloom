// Sign-in, recorder start and the library are three separate outcomes. A key that VideoDB
// accepted must stay accepted when something after it fails.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./helpers/fixture');
const { ServiceError } = require('../engine/videodb/errors');

const fixture = (t) => {
  const f = createFixture();
  t.after(() => f.engine.dispose());
  return f;
};

test('a rejected key and an unreachable service are different account states', async (t) => {
  const f = fixture(t);
  f.service.signIn = async () => {
    throw new ServiceError('authentication', 'Reconnect your VideoDB account.');
  };
  await f.command('signIn', { key: 'synthetic-key' });
  assert.equal(f.engine.getState().account.status, 'invalid');
  assert.equal(f.engine.getState().recorder.status, 'idle');

  f.service.signIn = async () => {
    throw new ServiceError('unavailable', 'VideoDB could not be reached.');
  };
  await f.command('signIn', { key: 'synthetic-key' });
  assert.equal(f.engine.getState().account.status, 'offline');
});

test('a recorder that fails to start never turns an accepted key into a bad one', async (t) => {
  const f = fixture(t);
  const channels = f.recorder.channels;
  f.recorder.channels = async () => {
    throw new Error('capture binary missing');
  };
  await f.command('signIn', { key: 'synthetic-key' });
  const failed = f.engine.getState();
  assert.equal(failed.account.status, 'signed-in');
  assert.equal(failed.recorder.status, 'failed');
  assert(failed.recorder.message.length > 0);
  assert(
    !failed.recorder.message.includes('capture binary'),
    'raw errors stay inside',
  );
  assert.equal(
    failed.problem,
    null,
    'not reported as a general problem either',
  );

  f.recorder.channels = channels;
  await f.command('prepareRecorder');
  const ready = f.engine.getState();
  assert.equal(ready.recorder.status, 'ready');
  assert.equal(ready.sources.screen, 'display:1');
  assert.equal(ready.account.status, 'signed-in');
});

test('a library failure after sign-in is a problem, not a sign-in failure', async (t) => {
  const f = fixture(t);
  f.service.listRecordings = async () => {
    throw new ServiceError('unavailable', 'VideoDB could not be reached.');
  };
  await f.command('signIn', { key: 'synthetic-key' });
  const state = f.engine.getState();
  assert.equal(state.account.status, 'signed-in');
  assert.equal(state.recorder.status, 'ready');
  assert.equal(state.problem.kind, 'unavailable');
});

test('the recorder passes through preparing, and signing out resets it', async (t) => {
  const f = fixture(t);
  const seen = [];
  f.engine.onState((s) => {
    if (seen.at(-1) !== s.recorder.status) seen.push(s.recorder.status);
  });
  await f.command('signIn', { key: 'synthetic-key' });
  assert.deepEqual(seen, ['idle', 'preparing', 'ready']);
  assert.equal(f.engine.command('prepareRecorder', { extra: true }), false);
  await f.command('signOut');
  assert.equal(f.engine.getState().recorder.status, 'idle');
  await f.command('prepareRecorder');
  assert.equal(
    f.engine.getState().recorder.status,
    'idle',
    'no recorder without an account',
  );
});

test('Sign in with VideoDB signs in with the browser’s token, and a cancel leaves the account signed out', async (t) => {
  let answer;
  const browserSignIn = {
    available: () => true,
    pending: () => !!answer,
    start: () => new Promise((resolve, reject) => (answer = { resolve, reject })),
    cancel: () => {
      answer?.reject(Object.assign(new ServiceError('cancelled', 'Sign-in was cancelled.'), { browser: true }));
      answer = null;
    },
  };
  const f = createFixture({ browserSignIn });
  t.after(() => f.engine.dispose());
  const tokens = [];
  f.service.signInWithToken = async (credential) => {
    tokens.push(credential);
    return { scopeId: f.scopeId };
  };
  f.engine.command('signInWithBrowser');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.engine.getState().account.status, 'checking');
  await f.command('cancelSignIn');
  assert.equal(f.engine.getState().account.status, 'signed-out');
  assert.equal(f.engine.getState().problem.kind, 'cancelled');

  f.engine.command('signInWithBrowser');
  await new Promise((resolve) => setImmediate(resolve));
  answer.resolve({ token: 'synthetic-console-token', userId: 'u-1', expiresAt: null });
  answer = null;
  await f.engine.whenIdle();
  assert.equal(f.engine.getState().account.status, 'signed-in');
  assert.deepEqual(tokens, [{ token: 'synthetic-console-token', userId: 'u-1', expiresAt: null }]);
});

test('Sign in with VideoDB says so when the build cannot open a browser', async (t) => {
  const f = fixture(t);
  await f.command('signInWithBrowser');
  assert.equal(f.engine.getState().problem.kind, 'unavailable');
  assert.equal(f.engine.getState().account.status, 'signed-out');
});
