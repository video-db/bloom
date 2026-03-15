'use strict';

/**
 * Ensures VideoDB capture binaries work in packaged Electron apps.
 *
 * The capture binary creates a lock file in its own directory.
 * In a packaged .app bundle, that directory is read-only (inside asar.unpacked).
 *
 * This module:
 * 1. Copies binaries from asar.unpacked to a writable userData/bin directory
 * 2. Intercepts child_process.spawn to redirect capture calls to the writable copy
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let spawnPatched = false;

function applyVideoDBPatches() {
  if (spawnPatched) return;

  // v0.2.2+ stores the binary inside VideoDBCapture.app/Contents/MacOS/
  const binBase = path
    .join(app.getAppPath(), 'node_modules', 'videodb', 'bin')
    .replace('app.asar', 'app.asar.unpacked');

  const srcDir = path.join(binBase, 'VideoDBCapture.app', 'Contents', 'MacOS');

  const destDir = path.join(app.getPath('userData'), 'bin');

  console.log('[videodb-patch] srcDir:', srcDir);
  console.log('[videodb-patch] destDir:', destDir);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Copy capture binary and librecorder.dylib to writable directory
  if (fs.existsSync(srcDir)) {
    for (const file of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, file);
      const dest = path.join(destDir, file);

      const srcStat = fs.statSync(src);
      if (!srcStat.isFile()) continue;

      if (!fs.existsSync(dest) || fs.statSync(dest).size !== srcStat.size) {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o755);
        console.log('[videodb-patch] Copied:', file);
      }
    }
  }

  // Intercept child_process.spawn to redirect capture binary to writable copy
  const cp = require('child_process');
  const origSpawn = cp.spawn;
  const binName = process.platform === 'win32' ? 'capture.exe' : 'capture';
  const writableBin = path.join(destDir, binName);

  cp.spawn = function (cmd, args, opts) {
    if (
      typeof cmd === 'string' &&
      cmd.includes('capture') &&
      !cmd.startsWith(destDir) &&
      fs.existsSync(writableBin)
    ) {
      const patchedOpts = { ...opts, cwd: destDir };
      console.log('[videodb-patch] Redirecting spawn to:', writableBin);
      return origSpawn.call(this, writableBin, args, patchedOpts);
    }
    return origSpawn.call(this, cmd, args, opts);
  };

  spawnPatched = true;
  console.log('[videodb-patch] Patched — capture will use writable binary at:', writableBin);
}

module.exports = { applyVideoDBPatches };
