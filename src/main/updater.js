// Bloom updates itself. It reads a signed feed, downloads and checks a newer version in the
// background, and puts it in place only when Bloom is not in use, or when the person next
// quits. Nothing is shown and nothing waits on it; anything that goes wrong is tried again
// later. Apple's updater is not used: it refuses builds that are not signed by Apple.
const crypto = require('node:crypto');
const fs = require('node:fs');
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
  if [ "$i" -gt 120 ]; then echo "timeout" > "$RESULT"; exit 1; fi
done
reopen() { if [ "$RELAUNCH" = "1" ]; then /usr/bin/open -g "$APP"; fi; }
rm -rf "$OLD"
if ! mv "$APP" "$OLD" 2>/dev/null; then echo "move-old-failed" > "$RESULT"; reopen; exit 1; fi
if ! mv "$NEW" "$APP" 2>/dev/null; then
  mv "$OLD" "$APP"; echo "move-new-failed" > "$RESULT"; reopen; exit 1
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
      return true;
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
        counts[name] = (counts[name] || 0) + 1;
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

  // Downloads, unpacks and checks one version. Leaves `ready` set when it may go in.
  async function stage(payload, file) {
    const dir = path.join(updatesDir, payload.version);
    const marker = path.join(dir, 'ready.json');
    if (fs.existsSync(marker)) {
      const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (fs.existsSync(saved.app)) return (ready = { ...saved, dir });
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const zip = path.join(dir, 'update.zip');
    await download(file, zip);
    const unpacked = path.join(dir, 'unpacked');
    await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked]);
    fs.rmSync(zip, { force: true });
    const apps = fs
      .readdirSync(unpacked)
      .filter((name) => name.endsWith('.app'));
    if (apps.length !== 1) throw new Error('the update holds no single app');
    const app = path.join(unpacked, apps[0]);
    const plist = path.join(app, 'Contents', 'Info.plist');
    const read = (key) =>
      run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
    if ((await read('CFBundleIdentifier')) !== BUNDLE_ID)
      throw new Error('the update is not Bloom');
    if ((await read('CFBundleShortVersionString')) !== payload.version)
      throw new Error('the update is not the version the feed says');
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    fs.writeFileSync(marker, JSON.stringify({ version: payload.version, app }));
    ready = { version: payload.version, app, dir };
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

  // Bloom has exited by the time the script swaps it; with relaunch it reopens to the tray.
  function install({ relaunch }) {
    if (!ready || installing || !fs.existsSync(ready.app)) return false;
    installing = true;
    const script = path.join(ready.dir, 'install.sh');
    fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o700 });
    fs.rmSync(path.join(ready.dir, 'result'), { force: true });
    spawn(
      '/bin/sh',
      [
        script,
        String(pid),
        appPath,
        ready.app,
        path.join(ready.dir, 'previous.app'),
        relaunch ? '1' : '0',
        path.join(ready.dir, 'result'),
      ],
      { detached: true, stdio: 'ignore' },
    ).unref();
    log(`installing update ${ready.version}`);
    return true;
  }

  function whenIdle() {
    if (!ready || installing) return;
    if (
      idle({
        state: getState(),
        windowsOpen: windowsOpen(),
        systemIdleSeconds: systemIdleSeconds(),
      }) &&
      install({ relaunch: true })
    )
      quit();
  }

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
    // Bloom is quitting anyway: a waiting update goes in now. True when the update will
    // also reopen Bloom, so the caller need not.
    applyOnQuit({ reopen = false } = {}) {
      if (!enabled || installing) return installing && reopen;
      return install({ relaunch: reopen }) && reopen;
    },
    stop() {
      for (const timer of timers.splice(0)) clearTimeout(timer);
    },
    // For tests and diagnostics.
    check,
    whenIdle,
    tidy,
    status: () => ({ ready: ready && { version: ready.version }, installing }),
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
