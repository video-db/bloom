// Bloom's self-update: a signed feed, a checked download, and a swap that happens only when
// Bloom is idle. The swap runs for real on folders in a temporary directory; nothing is
// installed on this Mac and no app is opened.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const {
  createUpdater,
  verifiedPayload,
  newer,
  idle,
} = require('../main/updater');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); // a test key only
// Stand-in apps never carry Bloom's own identity: macOS registers any app it finds, and a
// registered copy with Bloom's id can take the permissions meant for the real one.
const TEST_ID = 'com.videodb.bloom.updater-test';
const sign = (payload, key = privateKey) => {
  const text = JSON.stringify(payload);
  return {
    payload: text,
    signature: crypto.sign(null, Buffer.from(text), key).toString('base64'),
  };
};
const file = (extra) => ({
  url: 'https://artifacts.example/bloom.zip',
  sha256: 'a'.repeat(64),
  size: 10,
  ...extra,
});

test('versions are compared as numbers', () => {
  assert.equal(newer('2.3.10', '2.3.9'), true);
  assert.equal(newer('2.4.0', '2.3.99'), true);
  assert.equal(newer('2.3.9', '2.3.9'), false);
  assert.equal(newer('2.3.8', '2.3.9'), false);
});

test('only a feed signed with Bloom’s key, saying what an update must, is believed', () => {
  const good = { version: '2.3.10', files: { arm64: file() } };
  assert.deepEqual(verifiedPayload(sign(good), publicKey), good);
  // Changed after signing, or signed with another key: nothing.
  const tampered = sign(good);
  tampered.payload = tampered.payload.replace('2.3.10', '9.9.9');
  assert.equal(verifiedPayload(tampered, publicKey), null);
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.equal(verifiedPayload(sign(good, other), publicKey), null);
  // Plain http is refused, except to this Mac; a hash or size that is not one is refused.
  assert.equal(
    verifiedPayload(
      sign({
        ...good,
        files: { arm64: file({ url: 'http://evil.example/z' }) },
      }),
      publicKey,
    ),
    null,
  );
  assert.ok(
    verifiedPayload(
      sign({
        ...good,
        files: { arm64: file({ url: 'http://127.0.0.1:9/z' }) },
      }),
      publicKey,
    ),
  );
  assert.equal(
    verifiedPayload(
      sign({ ...good, files: { arm64: file({ sha256: 'x' }) } }),
      publicKey,
    ),
    null,
  );
  assert.equal(
    verifiedPayload(sign({ ...good, version: 'latest' }), publicKey),
    null,
  );
  assert.equal(verifiedPayload({ payload: 'x' }, publicKey), null);
  assert.equal(verifiedPayload(null, publicKey), null);
});

test('an update goes in only when Bloom is not in use', () => {
  const state = (extra) => ({
    phase: 'idle',
    pending: [],
    recordings: [],
    ...extra,
  });
  const away = (seconds, windowsOpen = false, s = state()) =>
    idle({ state: s, windowsOpen, systemIdleSeconds: seconds });
  assert.equal(away(90), true, 'no window, a minute and a half untouched');
  assert.equal(away(20), false, 'the person is at the Mac');
  assert.equal(
    away(5 * 60, true),
    false,
    'a window is open and they were here recently',
  );
  assert.equal(
    away(31 * 60, true),
    true,
    'a window left open, half an hour away',
  );
  for (const phase of [
    'starting',
    'recording',
    'paused',
    'stopping',
    'stopped',
    'saving',
  ])
    assert.equal(away(3600, false, state({ phase })), false, phase);
  assert.equal(
    away(3600, false, state({ pending: [{ status: 'processing' }] })),
    false,
    'a recording is being sent',
  );
  assert.equal(
    away(3600, false, state({ pending: [{ status: 'failed' }] })),
    true,
  );
  assert.equal(
    away(
      3600,
      false,
      state({ recordings: [{ making: { status: 'working' } }] }),
    ),
    false,
    'a version is being made',
  );
  assert.equal(away(3600, false, state({ phase: 'processing-error' })), true);
});

// A stand-in Bloom.app: right bundle id and version, signed ad hoc as Bloom's builds are.
function fakeApp(where, version, marker) {
  const app = path.join(where, 'Bloom.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(
    path.join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${TEST_ID}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>Bloom</string>
<key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  fs.writeFileSync(
    path.join(app, 'Contents', 'MacOS', 'Bloom'),
    '#!/bin/sh\nexit 0\n',
    { mode: 0o755 },
  );
  if (marker) {
    fs.mkdirSync(path.join(app, 'Contents', 'Resources'));
    fs.writeFileSync(path.join(app, 'Contents', 'Resources', marker), marker);
  }
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], {
    stdio: 'ignore',
  });
  return app;
}

async function serve(t, routes) {
  const server = http.createServer((req, res) => {
    const body = routes[req.url];
    if (body === undefined) return res.writeHead(404).end();
    res.writeHead(200).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

async function setup(t, { tamper = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-update-'));
  t.after(() => {
    fs.chmodSync(path.join(root, 'Applications'), 0o755); // a failed test may leave it locked
    fs.rmSync(root, { recursive: true, force: true });
  });
  const installed = path.join(root, 'Applications');
  fs.mkdirSync(installed);
  const appPath = fakeApp(installed, '2.3.10', 'old-build');
  // The release: the new app zipped as the release step does it.
  const build = path.join(root, 'build');
  fs.mkdirSync(build);
  const zip = path.join(root, 'bloom.zip');
  execFileSync('/usr/bin/ditto', [
    '-c',
    '-k',
    '--keepParent',
    fakeApp(build, '2.3.11', 'new-build'),
    zip,
  ]);
  const bytes = fs.readFileSync(zip);
  const base = await serve(t, {
    '/bloom.zip': tamper
      ? Buffer.concat([bytes, Buffer.from('x')]).subarray(1)
      : bytes,
    get '/latest-mac.json'() {
      return JSON.stringify(
        sign({
          version: '2.3.11',
          files: {
            arm64: {
              url: `${base}/bloom.zip`,
              sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
              size: bytes.length,
            },
          },
        }),
      );
    },
  });
  return { root, appPath, base };
}

const make = (s, extra = {}) =>
  createUpdater({
    version: '2.3.10',
    appPath: s.appPath,
    updatesDir: path.join(s.root, 'updates'),
    getState: () => ({ phase: 'idle', pending: [], recordings: [] }),
    feedUrl: `${s.base}/latest-mac.json`,
    publicKey,
    arch: 'arm64',
    bundleId: TEST_ID,
    ...extra,
  });

const waitFor = async (check, ms = 15000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};

// These fixtures build and sign a macOS .app with the system codesign tool.
const signedAppTest = process.platform === 'darwin' ? test : test.skip;

signedAppTest('a newer version is downloaded and checked; Bloom is asked to quit only when idle', async (t) => {
  const s = await setup(t);
  let quits = 0;
  const away = { seconds: 0 };
  const updater = make(s, {
    quit: () => quits++,
    systemIdleSeconds: () => away.seconds,
  });
  await updater.check();
  assert.equal(updater.status().ready.version, '2.3.11');
  assert.equal(updater.hasUpdate(), true);
  await updater.whenIdle(); // the person is at the Mac
  assert.equal(quits, 0);
  away.seconds = 120;
  await updater.whenIdle();
  assert.equal(quits, 1, 'asked to quit');
  await updater.whenIdle();
  assert.equal(quits, 1, 'asked once, not again while it quits');
  assert.equal(
    updater.status().installing,
    false,
    'nothing is started until Bloom quits',
  );
});

signedAppTest('as Bloom quits the update is checked again, then swapped in once Bloom has exited', async (t) => {
  const s = await setup(t);
  const bloom = spawn('/bin/sleep', ['30']); // stands in for the running Bloom
  t.after(() => bloom.kill());
  const updater = make(s, { pid: bloom.pid });
  await updater.check();
  // An ordinary quit, not to reopen: the swap starts, and waits for Bloom to have gone.
  assert.equal(await updater.applyOnQuit({ reopen: false }), false);
  assert.equal(updater.hasUpdate(), false);
  const dir = path.join(s.root, 'updates', '2.3.11');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(
    fs.existsSync(path.join(dir, 'result')),
    false,
    'not while Bloom runs',
  );
  bloom.kill();
  await waitFor(() => fs.existsSync(path.join(dir, 'result')));
  assert.equal(
    fs.readFileSync(path.join(dir, 'result'), 'utf8').trim(),
    'installed',
  );
  assert.ok(
    fs.existsSync(path.join(s.appPath, 'Contents', 'Resources', 'new-build')),
  );
  assert.ok(
    fs.existsSync(
      path.join(dir, 'previous.app', 'Contents', 'Resources', 'old-build'),
    ),
  );
  // The next launch, now 2.3.11, clears it all away.
  make(s, { version: '2.3.11' }).tidy();
  assert.equal(fs.existsSync(dir), false);
});

signedAppTest('an update changed on disk after it was checked is not installed', async (t) => {
  const s = await setup(t);
  const updater = make(s, { pid: 999999 });
  await updater.check();
  // Something running as the person changes the downloaded file.
  fs.appendFileSync(
    path.join(s.root, 'updates', '2.3.11', 'update.zip'),
    'tampered',
  );
  assert.equal(await updater.applyOnQuit({ reopen: false }), false);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(
    fs.existsSync(path.join(s.root, 'updates', '2.3.11', 'result')),
    false,
  );
  assert.ok(
    fs.existsSync(path.join(s.appPath, 'Contents', 'Resources', 'old-build')),
  );
});

signedAppTest('a download that does not match the feed is never installed', async (t) => {
  const s = await setup(t, { tamper: true });
  const updater = make(s, {
    systemIdleSeconds: () => 3600,
    quit: () => assert.fail('quit'),
  });
  await updater.check();
  assert.equal(updater.status().ready, null);
  await updater.whenIdle();
  assert.ok(
    fs.existsSync(path.join(s.appPath, 'Contents', 'Resources', 'old-build')),
  );
});

signedAppTest('nothing is done from a disk image, a folder Bloom cannot write to, or for an older version', async (t) => {
  const s = await setup(t);
  for (const appPath of [
    '/Volumes/Bloom/Bloom.app',
    '/private/var/folders/x/AppTranslocation/y/Bloom.app',
  ]) {
    const updater = make(s, { appPath });
    await updater.check();
    assert.equal(updater.status().ready, null, appPath);
  }
  fs.chmodSync(path.dirname(s.appPath), 0o555);
  try {
    const locked = make(s);
    await locked.check();
    assert.equal(locked.status().ready, null, 'cannot write where Bloom is');
  } finally {
    fs.chmodSync(path.dirname(s.appPath), 0o755);
  }
  const current = make(s, { version: '2.3.11' });
  await current.check();
  assert.equal(current.status().ready, null, 'already this version');
});

signedAppTest('a version that fails to go in twice is left alone, and the old app is put back', async (t) => {
  const s = await setup(t);
  const updatesDir = path.join(s.root, 'updates');
  const dir = path.join(updatesDir, '2.3.11');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const updater = make(s, { pid: 999999 }); // an exited process: the swap starts at once
    await updater.check();
    assert.ok(updater.status().ready, `attempt ${attempt}`);
    // Bloom's folder cannot be written to at the moment of the swap.
    fs.chmodSync(path.dirname(s.appPath), 0o555);
    assert.equal(
      await updater.applyOnQuit({ reopen: false }),
      false,
      'Bloom does not reopen',
    );
    await waitFor(() => fs.existsSync(path.join(dir, 'result')));
    fs.chmodSync(path.dirname(s.appPath), 0o755);
    assert.equal(
      fs.readFileSync(path.join(dir, 'result'), 'utf8').trim(),
      'move-old-failed',
    );
    assert.ok(
      fs.existsSync(path.join(s.appPath, 'Contents', 'Resources', 'old-build')),
      'the old app still runs',
    );
    make(s).tidy(); // the next launch counts it
  }
  assert.equal(fs.existsSync(dir), false, 'given up on');
  const after = make(s);
  await after.check();
  assert.equal(after.status().ready, null, 'not downloaded again');
});

signedAppTest('Check for updates says how it went, and Restart to update installs only when nothing is being processed', async (t) => {
  const s = await setup(t);
  let quits = 0;
  let state = { phase: 'idle', pending: [{ status: 'processing' }], recordings: [] };
  const updater = make(s, { quit: () => quits++, getState: () => state });
  const seen = [];
  updater.onStatus((shown) => seen.push(shown.state));
  await updater.checkNow();
  assert.deepEqual(seen, ['checking', 'downloading', 'ready']);
  assert.deepEqual(updater.shown(), { state: 'ready', version: '2.3.11' });
  // A recording is being processed: not now.
  assert.equal(updater.installNow(), false);
  assert.equal(quits, 0);
  state = { phase: 'idle', pending: [{ status: 'connection' }], recordings: [] };
  assert.equal(updater.installNow(), true);
  assert.equal(quits, 1);
  // Bloom reopens after the swap.
  t.after(() => fs.rmSync(path.join(s.root, 'updates'), { recursive: true, force: true }));
});

signedAppTest('Check for updates reports up to date, a failed check, and a Bloom that cannot update itself', async (t) => {
  const s = await setup(t);
  const current = make(s, { version: '2.3.11' });
  await current.checkNow();
  assert.equal(current.shown().state, 'current');
  assert.equal(typeof current.shown().checkedAt, 'number');

  const offline = make(s, { feedUrl: `${s.base}/missing.json` });
  await offline.checkNow();
  assert.equal(offline.shown().state, 'failed');
  // A background check that fails changes nothing that is shown.
  const quiet = make(s, { feedUrl: `${s.base}/missing.json` });
  await quiet.check();
  assert.equal(quiet.shown().state, 'idle');

  const fromDisk = make(s, { appPath: '/Volumes/Bloom/Bloom.app' });
  await fromDisk.checkNow();
  assert.equal(fromDisk.shown().state, 'unavailable');
});
