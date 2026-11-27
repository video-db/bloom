const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { idle } = require('./updater');

const exec = promisify(execFile);
async function run(file, args) {
  const { stdout } = await exec(file, args, {
    env: { ...process.env, LC_ALL: 'C' },
    timeout: 5 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

function createLinuxUpdater({
  getState, windowsOpen, systemIdleSeconds, quit, relaunch, version,
  fetchImpl = globalThis.fetch, command = run, resourcesPath = process.resourcesPath,
}) {
  let status = { state: 'idle' };
  let listener;
  let pending;
  let candidate;
  let restarting = false;
  const timers = [];
  function show(state, fields) {
    status = { state, ...fields };
    listener?.(status);
  }
  async function discover() {
    show('checking');
    try {
      const response = await fetchImpl('https://artifacts.videodb.io/bloom/internal/linux/latest-version.txt', {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error('Release pointer unavailable');
      const next = (await response.text()).trim();
      if (!/^\d+\.\d+\.\d+-linux\.preview\.\d+$/.test(next)) throw Error('Invalid version');
      if (next === version) return show('current', { checkedAt: Date.now() });
      await command('/usr/bin/dpkg', ['--compare-versions', next.replace('-', '~'), 'gt', version.replace('-', '~')]);
      candidate = next;
      show('ready', { version: next });
    } catch {
      candidate = null;
      show('failed');
    }
  }
  function checkNow() {
    if (candidate || restarting) return;
    if (!pending) pending = discover().finally(() => { pending = null; });
    return pending;
  }
  function installNow() {
    if (!candidate || restarting ||
        !idle({ state: getState(), windowsOpen: false, systemIdleSeconds: 60 })) return false;
    restarting = true;
    quit();
    return true;
  }
  return {
    shown: () => status,
    onStatus(cb) { listener = cb; },
    checkNow, installNow,
    start() {
      timers.push(setTimeout(checkNow, 3 * 60_000), setInterval(checkNow, 4 * 3600_000));
      timers.push(setInterval(() => {
        if (candidate && idle({ state: getState(), windowsOpen: windowsOpen(), systemIdleSeconds: systemIdleSeconds() }))
          installNow();
      }, 60_000));
    },
    stop() { timers.splice(0).forEach(clearTimeout); },
    hasUpdate: () => !!candidate,
    async applyOnQuit({ reopen }) {
      const id = candidate;
      candidate = null;
      try {
        await command('/usr/bin/pkexec', [require('node:path').join(resourcesPath, 'install-linux'), id]);
      } catch {
        show('failed');
      }
      if (restarting || reopen) {
        relaunch();
        return true;
      }
      return false;
    },
  };
}

module.exports = { createLinuxUpdater };
