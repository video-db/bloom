const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const { atomicWrite } = require('./files');
const { ServiceError } = require('./errors');

// Sign in with VideoDB: the console's OAuth 2.1 with PKCE and a loopback redirect (RFC 8252),
// ported from Call.md 2.0 (recorder/lib/auth.js). The console's access token works as
// x-access-token on the VideoDB API for 30 days and comes with no refresh token, so an expired
// token means signing in again. The token is returned to the caller, which keeps it as it keeps
// a key; nothing here writes it to disk.

const CONSOLES = {
  'https://api.dev.videodb.io': 'https://console.dev.videodb.io',
  'https://api.videodb.io': 'https://console.videodb.io',
};
// Client IDs VideoDB issues for Bloom, per console. Until one is issued, Bloom registers itself
// (RFC 7591) and keeps that registration per console.
const ISSUED_CLIENT_IDS = {
  'https://console.dev.videodb.io': null,
  'https://console.videodb.io': null,
};
const CLIENT_ID = /^vdba_[A-Za-z0-9_-]{4,400}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const SIGN_IN_TIMEOUT = 10 * 60 * 1000;
const REQUEST_TIMEOUT = 20 * 1000;

const MESSAGES = {
  network: 'Can’t reach VideoDB. Check your connection and try again.',
  'sign-in-unavailable':
    'Sign in with VideoDB isn’t available right now. Use an API key instead.',
  unsafe: 'VideoDB’s sign-in page didn’t check out, so sign-in stopped.',
  timeout: 'Sign-in took too long. Try again.',
  cancelled: 'Sign-in was cancelled.',
  denied: 'Sign-in was cancelled in the browser.',
  unfinished: 'Sign-in didn’t finish. Try again.',
  rejected: 'VideoDB didn’t accept this sign-in. Use an API key instead.',
};

const b64url = (bytes) =>
  Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const trimSlash = (value) => String(value || '').replace(/\/+$/, '');
// Marked as the browser's, so the account goes back to signed out rather than offline.
const fail = (code, message = MESSAGES[code] || MESSAGES.unfinished) =>
  Object.assign(new ServiceError(code, message), { browser: true });

function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(
    crypto.createHash('sha256').update(verifier).digest(),
  );
  return { verifier, challenge };
}

// A page the browser may be sent to: https, or plain http on this computer (local tests).
function isWebUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return !!url.hostname;
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname);
}

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

// The page the browser lands on. No scripts and nothing from the network; its address holds
// the sign-in code, so it sends no referrer.
function callbackPage(ok, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bloom</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<style>
html{color-scheme:light dark}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:Canvas;color:CanvasText}
main{max-width:520px;margin:0 auto;padding:clamp(48px,16vh,160px) 28px}
h1{margin:0;font-size:28px;font-weight:600;letter-spacing:-.01em}p{margin:10px 0 0;opacity:.72}
</style></head><body><main>
<h1>${ok ? 'You’re signed in to Bloom' : 'Sign-in didn’t finish'}</h1>
<p>${escapeHtml(message)}</p>
</main></body></html>`;
}

function deadline(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function createBrowserSignIn({
  apiUrl,
  openExternal,
  fetch = globalThis.fetch,
  registrationFile, // where a self-registered client ID is kept, per console
  issuer = CONSOLES[apiUrl],
  clientId = ISSUED_CLIENT_IDS[issuer] || null,
  timeoutMs = SIGN_IN_TIMEOUT,
  requestTimeoutMs = REQUEST_TIMEOUT,
  now = Date.now,
}) {
  issuer = trimSlash(issuer);
  let flow = null;

  async function getJson(url, init, signal) {
    let response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { accept: 'application/json', ...(init?.headers || {}) },
        signal: deadline(signal, requestTimeoutMs),
      });
    } catch (error) {
      if (signal?.aborted) throw fail('cancelled');
      throw fail('network');
    }
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body: body || {} };
  }

  // RFC 8414: metadata naming another issuer is not used, and every endpoint must be https.
  async function metadata(signal) {
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/openid-configuration',
    ]) {
      let answer;
      try {
        answer = await getJson(`${issuer}${path}`, {}, signal);
      } catch (error) {
        if (error.code === 'cancelled') throw error;
        continue;
      }
      const meta = answer.body;
      if (!answer.ok || !meta.authorization_endpoint || !meta.token_endpoint)
        continue;
      if (meta.issuer !== undefined && trimSlash(meta.issuer) !== issuer)
        throw fail('unsafe');
      for (const field of [
        'authorization_endpoint',
        'token_endpoint',
        'registration_endpoint',
      ])
        if (meta[field] !== undefined && !isWebUrl(meta[field]))
          throw fail('unsafe');
      return meta;
    }
    throw fail('network');
  }

  function savedRegistration() {
    try {
      const saved = JSON.parse(fs.readFileSync(registrationFile, 'utf8'));
      return saved?.issuer === issuer && CLIENT_ID.test(saved.clientId || '')
        ? saved.clientId
        : null;
    } catch {
      return null;
    }
  }
  function forgetRegistration() {
    if (registrationFile) fs.rmSync(registrationFile, { force: true });
  }

  async function client(meta, signal) {
    if (clientId) return clientId;
    const saved = registrationFile && savedRegistration();
    if (saved) return saved;
    if (!meta.registration_endpoint) throw fail('sign-in-unavailable');
    const answer = await getJson(
      meta.registration_endpoint,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Bloom by VideoDB',
          redirect_uris: ['http://127.0.0.1/callback'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          application_type: 'native',
          scope: 'videodb',
        }),
      },
      signal,
    );
    const id = answer.body.client_id;
    if (!answer.ok || typeof id !== 'string' || !id) throw fail('sign-in-unavailable');
    if (registrationFile)
      atomicWrite(registrationFile, JSON.stringify({ issuer, clientId: id }));
    return id;
  }

  // One-shot server for the redirect. Answers only /callback with the expected state.
  function loopback(expectedState, requireIss) {
    return new Promise((resolve, reject) => {
      let settle;
      const code = new Promise((res, rej) => {
        settle = { res, rej };
      });
      code.catch(() => {});
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/callback')
          return res.writeHead(404, { connection: 'close' }).end();
        const respond = (ok, message) => {
          res.writeHead(ok ? 200 : 400, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
            'content-security-policy':
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
            'x-content-type-options': 'nosniff',
            connection: 'close',
          });
          res.end(callbackPage(ok, message));
        };
        // A stale or foreign tab: answer it, but keep waiting for the real one.
        if (url.searchParams.get('state') !== expectedState)
          return respond(false, 'This sign-in link is out of date. Start again from Bloom.');
        // RFC 9207: the answer names the server that sent it.
        const iss = url.searchParams.get('iss');
        if ((iss !== null || requireIss) && trimSlash(iss) !== issuer) {
          respond(false, MESSAGES.unsafe);
          return settle.rej(fail('unsafe'));
        }
        const error = url.searchParams.get('error');
        if (error) {
          const kind =
            error === 'access_denied'
              ? 'denied'
              : ['invalid_client', 'unauthorized_client'].includes(error)
                ? 'invalid-client'
                : 'unfinished';
          respond(false, MESSAGES[kind] || MESSAGES.unfinished);
          return settle.rej(fail(kind, MESSAGES[kind] || MESSAGES.unfinished));
        }
        const value = url.searchParams.get('code');
        if (!value) {
          respond(false, MESSAGES.unfinished);
          return settle.rej(fail('unfinished'));
        }
        settle.res({ code: value, respond });
      });
      const timer = setTimeout(() => settle.rej(fail('timeout')), timeoutMs);
      timer.unref?.();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () =>
        resolve({
          port: server.address().port,
          wait: () => code.finally(() => clearTimeout(timer)),
          stop: (error) => settle.rej(error),
          // An idle browser connection must not keep the server, or Bloom, waiting.
          close: () => {
            server.close();
            server.closeAllConnections?.();
          },
        }),
      );
    });
  }

  // The VideoDB user behind a credential, or null when VideoDB refuses it.
  async function user(token, signal) {
    const answer = await getJson(
      `${trimSlash(apiUrl)}/user`,
      { headers: { 'x-access-token': token, 'x-videodb-client': 'bloom' } },
      signal,
    );
    if (!answer.ok) return null;
    const data = answer.body.data || answer.body;
    const userId = data.user_id || data.id || null;
    return typeof userId === 'string' && userId ? { userId } : null;
  }

  async function run(current) {
    const { signal } = current.abort;
    const meta = await metadata(signal);
    const id = await client(meta, signal);
    const { verifier, challenge } = pkcePair();
    const state = b64url(crypto.randomBytes(16));
    const server = await loopback(
      state,
      meta.authorization_response_iss_parameter_supported === true,
    );
    current.stop = server.stop;
    const redirectUri = `http://127.0.0.1:${server.port}/callback`;
    try {
      if (current.cancelled) throw fail('cancelled');
      const url = new URL(meta.authorization_endpoint);
      for (const [key, value] of Object.entries({
        response_type: 'code',
        client_id: id,
        redirect_uri: redirectUri,
        scope: 'videodb',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }))
        url.searchParams.set(key, value);
      current.url = url.toString();
      await openExternal(current.url);
      const { code, respond } = await server.wait();
      try {
        const answer = await getJson(
          meta.token_endpoint,
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
              client_id: id,
              code_verifier: verifier,
            }).toString(),
          },
          signal,
        );
        if (!answer.ok) {
          if (answer.body.error === 'invalid_client') throw fail('invalid-client', MESSAGES.unfinished);
          throw fail('unfinished');
        }
        const token = answer.body.videodb_api_key || answer.body.access_token;
        if (typeof token !== 'string' || !token || token.length > 4096)
          throw fail('rejected');
        const who = await user(token, signal);
        if (!who) throw fail('rejected');
        const expiresIn = Number(answer.body.expires_in);
        const credential = {
          token,
          userId: who.userId,
          expiresAt:
            !answer.body.videodb_api_key && expiresIn > 0
              ? now() + expiresIn * 1000
              : null,
        };
        respond(true, 'Bloom is ready to record. You can close this tab.');
        return credential;
      } catch (error) {
        respond(false, error.message || MESSAGES.unfinished);
        throw error;
      }
    } finally {
      server.close();
    }
  }

  return {
    available: () => !!issuer && typeof openExternal === 'function',
    // Resolves with { token, userId, expiresAt }. A second call while one is under way opens
    // the same page again and returns the same sign-in.
    start() {
      if (flow) {
        if (flow.url) Promise.resolve(openExternal(flow.url)).catch(() => {});
        return flow.promise;
      }
      const current = { abort: new AbortController(), cancelled: false };
      flow = current;
      current.promise = run(current)
        .catch((error) => {
          // A registration the console forgot is made again next time.
          if (['invalid-client', 'timeout'].includes(error.code) && !clientId)
            forgetRegistration();
          throw error instanceof ServiceError ? error : fail('unfinished');
        })
        .finally(() => {
          if (flow === current) flow = null;
        });
      return current.promise;
    },
    pending: () => !!flow,
    cancel() {
      if (!flow) return false;
      flow.cancelled = true;
      flow.abort.abort();
      flow.stop?.(fail('cancelled'));
      return true;
    },
  };
}

module.exports = {
  createBrowserSignIn,
  pkcePair,
  isWebUrl,
  callbackPage,
  CONSOLES,
  ISSUED_CLIENT_IDS,
};
