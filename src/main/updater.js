// Bloom updates itself. It reads a signed feed, downloads and checks a newer version in the
// background, and puts it in place only when Bloom is not in use, or when the person next
// quits. Nothing is shown and nothing waits on it; anything that goes wrong is tried again
// later. Apple's updater is not used: it refuses builds that are not signed by Apple.
const crypto = require('node:crypto');
// Electron's own fs treats an app.asar inside the downloaded app as a folder and cannot
// delete or copy it; its original-fs sees plain files. Plain Node (the tests) has only fs.
const fs = (() => {
  try {
    return require('original-fs');
  } catch {
    return require('node:fs');
  }
})();
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { PUBLIC_KEY } = require('./update-key');

const FEED_URL = 'https://artifacts.videodb.io/bloom/latest-mac.json';
const BUNDLE_ID = 'com.videodb.bloom';
const FIRST_CHECK_MS = 3 * 60 * 1000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const IDLE_POLL_MS = 60 * 1000;
const MAX_FAILURES = 2; // a version that fails to go in this often is left for a newer one
const MAX_SIZE = 800 * 1024 * 1024;

// Swaps the new app in once Bloom has exited, keeping the old one until that has worked
// and putting it back if it has not. Paths arrive as arguments, never inside the script.
const INSTALL_SCRIPT = `#!/bin/sh
PID="$1"; APP="$2"; NEW="$3"; OLD="$4"; RELAUNCH="$5"; RESULT="$6"
i=0
while kill -0 "$PID" 2>/dev/null; do
  sleep 0.5; i=$((i + 1))
  if [ "$i" -gt 600 ]; then echo "timeout" > "$RESULT"; exit 1; fi
done
reopen() { if [ "$RELAUNCH" = "1" ]; then /usr/bin/open -g "$APP"; fi; }
rm -rf "$OLD"
if ! mv "$APP" "$OLD"; then echo "move-old-failed" > "$RESULT"; reopen; exit 1; fi
if ! mv "$NEW" "$APP"; then
  rm -rf "$APP"; mv "$OLD" "$APP"; echo "move-new-failed" > "$RESULT"; reopen; exit 1
fi
echo "installed" > "$RESULT"
reopen
exit 0
`;

// "2.3.10" is newer than "2.3.9".
function newer(candidate, current) {
  const parts = (v) =>
    String(v)
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(candidate), parts(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

// https, or plain http to this Mac only (for testing a feed locally).
function allowedUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

// The feed's payload, only when Bloom's key signed it and it says what an update must.
function verifiedPayload(feed, publicKey = PUBLIC_KEY) {
  if (typeof feed?.payload !== 'string' || typeof feed?.signature !== 'string')
    return null;
  try {
    const signed = crypto.verify(
      null,
      Buffer.from(feed.payload, 'utf8'),
      publicKey,
      Buffer.from(feed.signature, 'base64'),
    );
    if (!signed) return null;
    const payload = JSON.parse(feed.payload);
    const files = payload?.files;
    if (
      !/^\d+\.\d+\.\d+$/.test(payload?.version) ||
      !files ||
      typeof files !== 'object'
    )
      return null;
    for (const file of Object.values(files))
      if (
        !allowedUrl(file?.url) ||
        !/^[a-f0-9]{64}$/.test(file?.sha256) ||
        !Number.isInteger(file?.size) ||
        file.size <= 0 ||
        file.size > MAX_SIZE
      )
        return null;
    return payload;
  } catch {
    return null;
  }
}

// When an update can go in without anyone noticing. Nothing being recorded, written, sent
// or made into a version; and either no Bloom window open and a minute without use, or
// half an hour away from the Mac with a window left open.
function idle({ state, windowsOpen, systemIdleSeconds }) {
  const quiet =
    ['idle', 'finished', 'processing-error'].includes(state?.phase) &&
    !(state.pending || []).some((p) => p.status === 'processing') &&
    !(state.recordings || []).some((r) => r.making?.status === 'working');
  if (!quiet) return false;
  return windowsOpen ? systemIdleSeconds >= 30 * 60 : systemIdleSeconds >= 60;
}

// The designated requirement an app is signed with, as codesign states it, or null.
async function requirementOf(app) {
  try {
    const text = await run('/usr/bin/codesign', ['-d', '-r-', app]);
    const line = text.split('\n').find((l) => l.startsWith('designated => '));
    return line ? line.slice('designated => '.length).trim() : null;
  } catch {
    return null;
  }
}

const run = (file, args, timeout = 5 * 60 * 1000) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout).trim()),
    ),
  );

function createUpdater({
  enabled = true,
  version,
  appPath, // the installed Bloom.app
  updatesDir,
  getState,
  windowsOpen = () => false,
  systemIdleSeconds = () => 0,
  quit = () => {},
  fetchImpl = globalThis.fetch,
  arch = process.arch,
  feedUrl = process.env.BLOOM_UPDATE_FEED || FEED_URL,
  publicKey = PUBLIC_KEY,
  pid = process.pid,
  bundleId = BUNDLE_ID, // tests use another, so their stand-in apps never pass for Bloom
  log = () => {},
}) {
  let ready = null; // { version, app, dir } once a checked update is waiting
  let busy = false;
  let installing = false;
  const timers = [];
  const failuresFile = path.join(updatesDir, 'failures.json');
  const failures = () => {
    try {
      return JSON.parse(fs.readFileSync(failuresFile, 'utf8')) || {};
    } catch {
      return {};
    }
  };

  // Somewhere Bloom can replace itself: not a disk image, not a translocated copy.
  function placeable() {
    if (!appPath?.endsWith('.app') || appPath.includes('/AppTranslocation/'))
      return false;
    if (appPath.startsWith('/Volumes/')) return false;
    try {
      fs.accessSync(path.dirname(appPath), fs.constants.W_OK);
      fs.accessSync(appPath, fs.constants.W_OK);
      fs.mkdirSync(updatesDir, { recursive: true, mode: 0o700 });
      // Both moves in the swap must be renames on one volume: a copy across volumes can
      // stop half way and leave no app at all.
      return (
        fs.statSync(updatesDir).dev === fs.statSync(path.dirname(appPath)).dev
      );
    } catch {
      return false;
    }
  }

  // At launch: what an earlier install did, and what is no longer needed.
  function tidy() {
    if (!fs.existsSync(updatesDir)) return;
    const counts = failures();
    for (const name of fs.readdirSync(updatesDir)) {
      const dir = path.join(updatesDir, name);
      if (!/^\d+\.\d+\.\d+$/.test(name)) continue;
      let result = '';
      try {
        result = fs.readFileSync(path.join(dir, 'result'), 'utf8').trim();
      } catch {
        /* not tried yet */
      }
      if (result && result !== 'installed') {
        if (result !== 'timeout') counts[name] = (counts[name] || 0) + 1;
        log(`update ${name} did not go in: ${result}`);
        fs.rmSync(path.join(dir, 'result'), { force: true });
      }
      // Installed, older, or given up on: the folder (with the previous app) goes.
      if (
        !newer(name, version) ||
        (counts[name] || 0) >= MAX_FAILURES ||
        result === 'installed'
      )
        fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.writeFileSync(failuresFile, JSON.stringify(counts));
  }

  async function download(file, to) {
    const response = await fetchImpl(file.url, {
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!response.ok || !response.body)
      throw new Error(`download answered ${response.status}`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(to, { mode: 0o600 });
    let size = 0;
    try {
      for await (const chunk of Readable.fromWeb(response.body)) {
        size += chunk.length;
        if (size > file.size)
          throw new Error('download is larger than the feed says');
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (size !== file.size || hash.digest('hex') !== file.sha256)
      throw new Error('download does not match the feed');
  }

  const sha256Of = (file) =>
    new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      fs.createReadStream(file)
        .on('error', reject)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', () => resolve(hash.digest('hex')));
    });

  // Unpacks the checked zip afresh and checks the app in it. Nothing left on disk from
  // before is trusted: the folder is Bloom's, but anything running as the person can
  // write to it. Returns the app's path.
  async function unpack(dir, payload, file) {
    const zip = path.join(dir, 'update.zip');
    if (
      !fs.existsSync(zip) ||
      fs.statSync(zip).size !== file.size ||
      (await sha256Of(zip)) !== file.sha256
    )
      throw new Error('the downloaded update does not match the feed');
    const unpacked = path.join(dir, 'unpacked');
    fs.rmSync(unpacked, { recursive: true, force: true });
    await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked]);
    const app = path.join(unpacked, 'Bloom.app');
    const entries = fs.readdirSync(unpacked);
    // Exactly Bloom.app, a real folder, not a link to somewhere else.
    if (
      entries.length !== 1 ||
      entries[0] !== 'Bloom.app' ||
      !fs.lstatSync(app).isDirectory()
    )
      throw new Error('the update holds no single Bloom.app');
    const plist = path.join(app, 'Contents', 'Info.plist');
    if (!fs.lstatSync(plist).isFile())
      throw new Error('the update has no Info.plist');
    const read = (key) =>
      run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
    if ((await read('CFBundleIdentifier')) !== bundleId)
      throw new Error('the update is not Bloom');
    if ((await read('CFBundleShortVersionString')) !== payload.version)
      throw new Error('the update is not the version the feed says');
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    // Once Bloom is signed with its own certificate, an update must be signed with the same
    // one: the running app's requirement names it ("certificate root" for a self-signed
    // one). An ad hoc Bloom names only its own build's hash.
    const required = await requirementOf(appPath);
    if (/certificate (leaf|root)/.test(required || ''))
      await run('/usr/bin/codesign', [
        '--verify',
        '--deep',
        '--strict',
        `-R=${required}`,
        app,
      ]);
    return app;
  }

  // Downloads one version, unless its checked zip is already here, and checks it. Leaves
  // `ready` set when it may go in.
  async function stage(payload, file) {
    const dir = path.join(updatesDir, payload.version);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const zip = path.join(dir, 'update.zip');
    let app;
    try {
      app = await unpack(dir, payload, file);
    } catch {
      fs.rmSync(zip, { force: true });
      await download(file, zip);
      app = await unpack(dir, payload, file);
    }
    ready = { payload, file, dir, app };
    log(`update ${payload.version} is ready`);
    return ready;
  }

  async function check() {
    if (busy || installing || ready) return;
    busy = true;
    try {
      if (!placeable()) return;
      const response = await fetchImpl(feedUrl, {
        signal: AbortSignal.timeout(30 * 1000),
      });
      if (!response.ok) return;
      const payload = verifiedPayload(await response.json(), publicKey);
      if (!payload || !newer(payload.version, version)) return;
      if ((failures()[payload.version] || 0) >= MAX_FAILURES) return;
      const file = payload.files[arch];
      if (!file) return;
      await stage(payload, file);
    } catch (error) {
      log(`update check: ${error.message}`); // tried again at the next check
    } finally {
      busy = false;
    }
  }

  // Swaps the update in once Bloom has exited, reopening it to the tray when asked. Runs
  // as Bloom quits, never before: a quit that is called off leaves nothing behind. The app
  // is checked again first. True when the script was started.
  async function install({ relaunch }) {
    if (!ready || installing) return false;
    installing = true;
    try {
      const app = await unpack(ready.dir, ready.payload, ready.file);
      const script = path.join(ready.dir, 'install.sh');
      fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o700 });
      fs.rmSync(path.join(ready.dir, 'result'), { force: true });
      const child = spawn(
        '/bin/sh',
        [
          script,
          String(pid),
          appPath,
          app,
          path.join(ready.dir, 'previous.app'),
          relaunch ? '1' : '0',
          path.join(ready.dir, 'result'),
        ],
        { detached: true, stdio: 'ignore' },
      );
      child.on('error', (error) => log(`install script: ${error.message}`));
      child.unref();
      log(`installing update ${ready.payload.version}`);
      return true;
    } catch (error) {
      log(`update not installed: ${error.message}`);
      ready = null; // checked again from scratch at the next check
      installing = false;
      return false;
    }
  }

  // Idle: Bloom is asked to quit, and the update goes in as it does (applyOnQuit). If the
  // quit is called off, nothing has been started, and the next idle moment tries again.
  let quitAskedAt = 0;
  async function whenIdle() {
    if (!ready || installing) return;
    // Asked to quit a while ago and still running: the quit was called off. Start over,
    // and do not reopen Bloom at some later quit the person makes themselves.
    if (quitAskedAt && Date.now() - quitAskedAt >= 2 * 60 * 1000) {
      quitAskedAt = 0;
      relaunchAfter = false;
    }
    if (quitAskedAt) return;
    if (
      idle({
        state: getState(),
        windowsOpen: windowsOpen(),
        systemIdleSeconds: systemIdleSeconds(),
      })
    ) {
      quitAskedAt = Date.now();
      relaunchAfter = true;
      // The update is checked again before Bloom is asked to quit, so a bad one never
      // costs a restart.
      try {
        await unpack(ready.dir, ready.payload, ready.file);
      } catch (error) {
        log(`update not installed: ${error.message}`);
        ready = null;
        relaunchAfter = false;
        return;
      }
      quit();
    }
  }
  let relaunchAfter = false; // set when Bloom quits for the update and should come back

  return {
    start() {
      if (!enabled) return;
      try {
        tidy();
      } catch (error) {
        log(`update tidy: ${error.message}`);
      }
      timers.push(setTimeout(check, FIRST_CHECK_MS));
      timers.push(setInterval(check, CHECK_EVERY_MS));
      timers.push(setInterval(whenIdle, IDLE_POLL_MS));
      for (const timer of timers) timer.unref?.();
    },
    // Bloom is quitting: a waiting update goes in now. The script is started from here
    // only. Returns a promise of true when the update will also reopen Bloom.
    applyOnQuit({ reopen = false } = {}) {
      const relaunch = reopen || relaunchAfter;
      relaunchAfter = false;
      if (!enabled || !ready) return Promise.resolve(false);
      return install({ relaunch }).then((started) => started && relaunch);
    },
    // Whether quitting should wait for applyOnQuit.
    hasUpdate: () => enabled && !!ready && !installing,
    stop() {
      for (const timer of timers.splice(0)) clearTimeout(timer);
    },
    // For tests and diagnostics.
    check,
    whenIdle,
    tidy,
    status: () => ({
      ready: ready && { version: ready.payload.version },
      installing,
    }),
  };
}

module.exports = {
  createUpdater,
  verifiedPayload,
  newer,
  idle,
  INSTALL_SCRIPT,
  FEED_URL,
};
