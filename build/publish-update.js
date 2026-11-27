// Makes a release ready to upload, from what `npm run dist` just built:
//   node build/publish-update.js
// dist/release/ then holds exactly what goes to artifacts.videodb.io/bloom/, laid out as the
// host keeps it: v<version>/ with both DMGs, both update zips and a .sha256 beside each;
// and, at the top, latest-mac.json (the update feed, signed with the release key from
// build/update-key.js) and latest-version.txt (what the install script reads). Publish it
// through binary-publish (docs/runbook.md, "Publish an update"), which writes the checksums
// and latest-version.txt itself and moves the pointers last.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KEY_FILE } = require('./update-key');
const { verifiedPayload } = require('../src/main/updater');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const HOST =
  process.env.BLOOM_UPDATE_BASE || 'https://artifacts.videodb.io/bloom';
const { version } = require('../package.json');
const BUILDS = { arm64: 'mac-arm64', x64: 'mac' };
const RELEASE = path.join(DIST, 'release');
const FOLDER = path.join(RELEASE, `v${version}`);

const plist = (app, key) =>
  execFileSync('/usr/bin/plutil', [
    '-extract',
    key,
    'raw',
    '-o',
    '-',
    path.join(app, 'Contents', 'Info.plist'),
  ])
    .toString()
    .trim();

// As the host keeps them: "<sha256>  <name>" on one line, beside the file.
function checksum(file) {
  const sha = crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
  fs.writeFileSync(`${file}.sha256`, `${sha}  ${path.basename(file)}\n`);
  return sha;
}

fs.rmSync(RELEASE, { recursive: true, force: true });
fs.mkdirSync(FOLDER, { recursive: true });
const files = {};
for (const [arch, folder] of Object.entries(BUILDS)) {
  const app = path.join(DIST, folder, 'Bloom.app');
  const dmg = path.join(DIST, `bloom-${version}-mac-${arch}.dmg`);
  for (const needed of [app, dmg])
    if (!fs.existsSync(needed))
      throw new Error(`No ${arch} build at ${needed}; run npm run dist first.`);
  if (plist(app, 'CFBundleShortVersionString') !== version)
    throw new Error(`The ${arch} build is not version ${version}; build again.`);
  const shippedDmg = path.join(FOLDER, path.basename(dmg));
  fs.copyFileSync(dmg, shippedDmg);
  checksum(shippedDmg);
  // ditto keeps the app's signature, links and permissions as a Mac copy would.
  const name = `bloom-${version}-mac-${arch}.zip`;
  const zip = path.join(FOLDER, name);
  execFileSync('/usr/bin/ditto', [
    '-c',
    '-k',
    '--sequesterRsrc',
    '--keepParent',
    app,
    zip,
  ]);
  files[arch] = {
    url: `${HOST}/v${version}/${name}`,
    sha256: checksum(zip),
    size: fs.statSync(zip).size,
  };
}

const payload = JSON.stringify({
  version,
  releasedAt: new Date().toISOString(),
  files,
});
const key = crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
const feed = {
  payload,
  signature: crypto
    .sign(null, Buffer.from(payload, 'utf8'), key)
    .toString('base64'),
};
// The app must accept what was just signed, with the public key it ships with.
if (!verifiedPayload(feed))
  throw new Error('The feed does not verify with src/main/update-key.js.');
fs.writeFileSync(
  path.join(RELEASE, 'latest-mac.json'),
  JSON.stringify(feed, null, 2) + '\n',
);
fs.writeFileSync(path.join(RELEASE, 'latest-version.txt'), `${version}\n`);
console.log(
  `Release ${version} ready in ${RELEASE}. In binary-publish, publish ${version} with the four files in v${version}/ and latest-mac.json.`,
);
