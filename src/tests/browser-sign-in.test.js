const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createBrowserSignIn,
  isWebUrl,
  callbackPage,
} = require('../engine/videodb/browser-sign-in');
const { createCredentialStore } = require('../engine/videodb/credentials');
const { createVideoDBService, DEV_API } = require('../engine/videodb/service');

const ISSUER = 'https://console.dev.videodb.io';
const b64url = (bytes) =>
  Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

// A stand-in console and API. `browser` is what the person does on the console's page.
function consoleFake({
  meta = {},
  user = { user_id: 'u-synthetic' },
  register = { client_id: 'vdba_selfregistered' },
  browser = 'approve',
} = {}) {
  const seen = { registered: 0, tokens: [], opened: [] };
  let challenge = null;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/.well-known/oauth-authorization-server')
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        registration_endpoint: `${ISSUER}/oauth/register`,
        authorization_response_iss_parameter_supported: true,
        ...meta,
      });
    if (u.pathname === '/oauth/register') {
      seen.registered += 1;
      return json(register);
    }
    if (u.pathname === '/oauth/token') {
      const form = new URLSearchParams(init.body);
      seen.tokens.push(Object.fromEntries(form));
      const expected = b64url(
        crypto.createHash('sha256').update(form.get('code_verifier')).digest(),
      );
      if (form.get('code') !== 'synthetic-code' || expected !== challenge)
        return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'synthetic-console-token', expires_in: 2592000 });
    }
    if (u.pathname === '/user')
      return init.headers['x-access-token'] === 'synthetic-console-token' && user
        ? json({ success: true, data: user })
        : json({ success: false }, 401);
    return json({}, 404);
  };
  // Like shell.openExternal, opening returns at once; the person acts afterwards.
  const openExternal = async (url) => {
    seen.done = act(url);
    seen.done.catch(() => {});
  };
  const act = async (url) => {
    seen.opened.push(url);
    const u = new URL(url);
    challenge = u.searchParams.get('code_challenge');
    const back = new URL(u.searchParams.get('redirect_uri'));
    const state = u.searchParams.get('state');
    // A stale tab from an earlier attempt arrives first and must be ignored.
    if (browser === 'approve') {
      await globalThis.fetch(`${back}?code=old&state=stale&iss=${ISSUER}`);
      back.searchParams.set('code', 'synthetic-code');
      back.searchParams.set('state', state);
      back.searchParams.set('iss', ISSUER);
    } else if (browser === 'deny') {
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('state', state);
      back.searchParams.set('iss', ISSUER);
    } else if (browser === 'wrong-issuer') {
      back.searchParams.set('code', 'synthetic-code');
      back.searchParams.set('state', state);
      back.searchParams.set('iss', 'https://elsewhere.example');
    } else return; // 'wait': the person never comes back
    seen.page = await (await globalThis.fetch(back)).text();
  };
  return { fetch, openExternal, seen };
}

const signIn = (fake, options = {}) =>
  createBrowserSignIn({
    apiUrl: DEV_API,
    fetch: fake.fetch,
    openExternal: fake.openExternal,
    clientId: 'vdba_issuedforbloom',
    now: () => 1000,
    ...options,
  });

test('Sign in with VideoDB returns the console token and its user, with PKCE and the issued client ID', async () => {
  const fake = consoleFake();
  const result = await signIn(fake).start();
  assert.deepEqual(result, {
    token: 'synthetic-console-token',
    userId: 'u-synthetic',
    expiresAt: 1000 + 2592000 * 1000,
  });
  const opened = new URL(fake.seen.opened[0]);
  assert.equal(opened.origin + opened.pathname, `${ISSUER}/oauth/authorize`);
  assert.equal(opened.searchParams.get('client_id'), 'vdba_issuedforbloom');
  assert.equal(opened.searchParams.get('scope'), 'videodb');
  assert.equal(opened.searchParams.get('code_challenge_method'), 'S256');
  assert.match(opened.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.equal(fake.seen.registered, 0);
  assert.equal(fake.seen.tokens[0].client_id, 'vdba_issuedforbloom');
  await fake.seen.done;
  assert.match(fake.seen.page, /You’re signed in to Bloom/);
  assert.doesNotMatch(fake.seen.page, /<script/i);
});

test('without an issued client ID Bloom registers itself once per console', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-signin-'));
  try {
    const registrationFile = path.join(dir, 'sign-in-client.json');
    const fake = consoleFake();
    await signIn(fake, { clientId: null, registrationFile }).start();
    await signIn(fake, { clientId: null, registrationFile }).start();
    assert.equal(fake.seen.registered, 1);
    assert.equal(fake.seen.tokens[1].client_id, 'vdba_selfregistered');
    assert.equal(fs.statSync(registrationFile).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a sign-in that does not check out stops with a plain reason', async () => {
  await assert.rejects(
    signIn(consoleFake({ meta: { issuer: 'https://elsewhere.example' } })).start(),
    { code: 'unsafe', browser: true },
  );
  await assert.rejects(
    signIn(consoleFake({ meta: { token_endpoint: 'http://evil.example/token' } })).start(),
    { code: 'unsafe' },
  );
  await assert.rejects(signIn(consoleFake({ browser: 'wrong-issuer' })).start(), {
    code: 'unsafe',
  });
  await assert.rejects(signIn(consoleFake({ browser: 'deny' })).start(), {
    code: 'denied',
    message: 'Sign-in was cancelled in the browser.',
  });
  await assert.rejects(signIn(consoleFake({ user: null })).start(), {
    code: 'rejected',
  });
  await assert.rejects(
    signIn({
      ...consoleFake(),
      fetch: async () => {
        throw new Error('offline');
      },
    }).start(),
    { code: 'network' },
  );
});

test('a sign-in can be cancelled and times out', async () => {
  const waiting = signIn(consoleFake({ browser: 'wait' }));
  const started = waiting.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(waiting.pending(), true);
  assert.equal(waiting.cancel(), true);
  await assert.rejects(started, { code: 'cancelled' });
  assert.equal(waiting.pending(), false);
  await assert.rejects(
    signIn(consoleFake({ browser: 'wait' }), { timeoutMs: 30 }).start(),
    { code: 'timeout' },
  );
});

test('only https pages, or plain http on this computer, are opened', () => {
  assert.equal(isWebUrl('https://console.videodb.io/oauth/authorize'), true);
  assert.equal(isWebUrl('http://127.0.0.1:9/callback'), true);
  assert.equal(isWebUrl('http://console.videodb.io'), false);
  assert.equal(isWebUrl('file:///etc/passwd'), false);
  assert.equal(isWebUrl('https://user:pw@console.videodb.io'), false);
  assert.match(callbackPage(false, '<b>x</b>'), /&lt;b&gt;x&lt;\/b&gt;/);
});

test('the credentials file keeps a browser sign-in as version 2 and still reads a pasted key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-cred2-'));
  try {
    const file = path.join(dir, 'credentials.json');
    const store = createCredentialStore({ file });
    store.write('synthetic-test-key');
    assert.deepEqual(store.readCredential(), { kind: 'key', secret: 'synthetic-test-key' });
    store.writeToken({ token: 'synthetic-console-token', userId: 'u-1', expiresAt: 5 });
    assert.deepEqual(createCredentialStore({ file }).readCredential(), {
      kind: 'token',
      secret: 'synthetic-console-token',
      userId: 'u-1',
      expiresAt: 5,
    });
    assert.equal(store.read(), 'synthetic-console-token');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => store.writeToken({ token: 'x', userId: '' }), { code: 'invalid-input' });
    fs.writeFileSync(file, JSON.stringify({ version: 2, kind: 'token', token: 'x' }));
    assert.throws(() => store.readCredential(), { code: 'credential-storage' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function serviceWith(store) {
  const conn = { getCollections: async () => [{ id: 'c1', name: 'Bloom Recordings' }] };
  const used = [];
  const service = createVideoDBService({
    connect: ({ apiKey }) => {
      used.push(apiKey);
      return conn;
    },
    credentials: store,
  });
  return { service, used };
}

test('a browser sign-in is known by its VideoDB user, so a new token keeps the same recordings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scope-'));
  try {
    const store = createCredentialStore({ file: path.join(dir, 'credentials.json') });
    const { service, used } = serviceWith(store);
    const first = await service.signInWithToken({ token: 'token-1', userId: 'u-1', expiresAt: null });
    service.signOut();
    const second = await service.signInWithToken({ token: 'token-2', userId: 'u-1', expiresAt: null });
    assert.equal(first.scopeId, second.scopeId);
    assert.equal(service.cachedIdentity().scopeId, second.scopeId);
    assert.deepEqual(used, ['token-1', 'token-2'], 'the token goes to the SDK as the key does');
    assert.equal(service.signInMethod(), 'token');
    service.signOut();
    const other = await service.signInWithToken({ token: 'token-3', userId: 'u-2', expiresAt: null });
    assert.notEqual(other.scopeId, first.scopeId);
    service.signOut();
    // A pasted key keeps the scope it always had.
    const keyed = await service.signIn('synthetic-test-key');
    assert.equal(
      keyed.scopeId,
      crypto.createHash('sha256').update(`${DEV_API}\0synthetic-test-key`).digest('hex'),
    );
    assert.equal(service.signInMethod(), 'key');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a saved browser sign-in that ran out asks to sign in again without calling VideoDB', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-expired-'));
  try {
    const store = createCredentialStore({ file: path.join(dir, 'credentials.json') });
    store.writeToken({ token: 'old-token', userId: 'u-1', expiresAt: Date.now() - 1 });
    const { service, used } = serviceWith(store);
    await assert.rejects(service.restore(), { code: 'authentication' });
    assert.deepEqual(used, []);
    store.writeToken({ token: 'live-token', userId: 'u-1', expiresAt: Date.now() + 60000 });
    assert.ok(await service.restore());
    assert.deepEqual(used, ['live-token']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
