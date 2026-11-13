const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { RecorderInstaller } = require('videodb-capture');

function hasArchitecture(file, arch) {
  const nativeArch = arch === 'x64' ? 'x86_64' : arch;
  if (!fs.existsSync(file)) return false;
  return execFileSync('lipo', ['-archs', file], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)
    .includes(nativeArch);
}

async function prepareMacRecorder(bundle, arch) {
  if (!['arm64', 'x64'].includes(arch))
    throw new Error(`Unsupported recorder target: ${arch}`);
  const binaries = ['capture', 'librecorder.dylib'].map((name) =>
    path.join(bundle, 'Contents', 'MacOS', name),
  );
  if (binaries.every((file) => hasArchitecture(file, arch))) return;

  // SDK installation follows the host CPU. Resolve its pinned target artifact through
  // public APIs, and replace only the packaged copy so parallel targets stay isolated.
  class TargetInstaller extends RecorderInstaller {
    getPlatformInfo() {
      return { platform: 'darwin', arch, platformKey: `darwin-${arch}` };
    }
  }
  const installer = new TargetInstaller();
  const checksum = installer.getExpectedChecksum();
  if (!checksum) throw new Error(`No pinned recorder checksum for ${arch}`);
  const response = await fetch(installer.getDownloadUrl(), {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error(`Recorder download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== checksum)
    throw new Error(`Recorder checksum mismatch for ${arch}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-recorder-'));
  try {
    const archivePath = path.join(temp, 'capture.tar.gz');
    fs.writeFileSync(archivePath, archive);
    execFileSync('tar', ['-xzf', archivePath, '-C', temp]);
    const extracted = path.join(temp, 'VideoDBCapture.app');
    for (const name of ['capture', 'librecorder.dylib']) {
      if (
        !hasArchitecture(path.join(extracted, 'Contents', 'MacOS', name), arch)
      )
        throw new Error(`Downloaded recorder does not support ${arch}`);
    }
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.cpSync(extracted, bundle, { recursive: true });
    console.log(
      `Installed checksum-verified ${arch} recorder into packaged app.`,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { prepareMacRecorder, hasArchitecture };
