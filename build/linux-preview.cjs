// Build an internal Debian package without modifying the checkout's SDK or lockfile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const recorderHash = '08ba4f62a2e1c138b7de7cbf5bc563636b71a70052ee741870345ec169e1ceb1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function build() {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.argv.length !== 3)
    throw Error('Usage on Ubuntu x64: node build/linux-preview.cjs capture-linux-x64.tar.gz');
  const native = fs.readFileSync(process.argv[2]);
  if (sha256(native) !== recorderHash)
    throw Error('Linux preview input checksum mismatch');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-linux-build-'));
  const write = (file, value) => fs.writeFileSync(path.join(dir, file), value);
  const json = (file, value) => write(file, JSON.stringify(value, null, 2));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: 'inherit' });
  try {
    for (const folder of ['src', 'build', 'vendor'])
      fs.cpSync(path.join(root, folder), path.join(dir, folder), { recursive: true });
    const pkg = require(path.join(root, 'package.json'));
    const lock = require(path.join(root, 'package-lock.json'));
    json('package-lock.json', lock);
    pkg.version += '-linux.preview.3';
    pkg.bloomLinuxPreview = true;
    pkg.homepage = 'https://github.com/video-db/bloom';
    pkg.build.extraResources = [{ from: 'build/install-linux', to: 'install-linux' }];
    pkg.build.linux = {
      target: ['deb'], category: 'AudioVideo', maintainer: 'VideoDB',
      icon: 'icon.png', artifactName: 'bloom-${version}-${arch}.${ext}',
    };
    // The checked-in Windows icon contains the approved mark as a single 256px PNG.
    const ico = fs.readFileSync(path.join(root, 'build/icon.ico'));
    const offset = ico.readUInt32LE(18);
    const png = ico.subarray(offset, offset + ico.readUInt32LE(14));
    if (png.toString('ascii', 1, 4) !== 'PNG') throw Error('Expected PNG in build/icon.ico');
    write('icon.png', png);
    json('package.json', pkg);
    run('npm', ['ci', '--no-audit', '--no-fund']);
    const { RecorderInstaller } = require(path.join(dir, 'node_modules/videodb-capture/dist/capture/installer'));
    const installer = new RecorderInstaller();
    if (installer.getExpectedChecksum() !== recorderHash) throw Error('SDK recorder checksum mismatch');
    // Supply our verified archive to the normal installer; it validates and stamps the bundle.
    installer.downloadFile = async (_url, destination) => fs.writeFileSync(destination, native);
    await installer.install({ force: true });
    run('npm', ['run', 'dist', '--', '--linux', 'deb', '--x64', '--publish', 'never']);
    const artifact = 'bloom-' + pkg.version + '-amd64.deb';
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(dir, 'dist', artifact), path.join(root, 'dist', artifact));
    console.log(path.join(root, 'dist', artifact));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
build().catch(error => { console.error(error.message); process.exitCode = 1; });
