// Makes what Bloom's self-update reads, from the apps `npm run dist` just built:
//   node build/publish-update.js
// It writes, in dist/: one zip per architecture and latest-mac.json, the feed, signed with
// the release key (build/update-key.js). Upload all of them beside the DMGs; the feed last,
// so it never points at a zip that is not there yet.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KEY_FILE } = require('./update-key');
const { verifiedPayload } = require('../src/main/updater');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BASE_URL =
  process.env.BLOOM_UPDATE_BASE || 'https://artifacts.videodb.io/bloom';
const { version } = require('../package.json');
const BUILDS = { arm64: 'mac-arm64', x64: 'mac' };

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

const files = {};
for (const [arch, folder] of Object.entries(BUILDS)) {
  const app = path.join(DIST, folder, 'Bloom.app');
  if (!fs.existsSync(app))
    throw new Error(`No ${arch} build at ${app}; run npm run dist first.`);
  if (plist(app, 'CFBundleShortVersionString') !== version)
    throw new Error(
      `The ${arch} build is not version ${version}; build again.`,
    );
  const name = `bloom-${version}-mac-${arch}.zip`;
  const zip = path.join(DIST, name);
  fs.rmSync(zip, { force: true });
  // ditto keeps the app's signature, links and permissions as a Mac copy would.
  execFileSync('/usr/bin/ditto', [
    '-c',
    '-k',
    '--sequesterRsrc',
    '--keepParent',
    app,
    zip,
  ]);
  const bytes = fs.readFileSync(zip);
  files[arch] = {
    url: `${BASE_URL}/${name}`,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  };
  console.log(
    `${name}  ${files[arch].size} bytes  sha256 ${files[arch].sha256}`,
  );
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
  path.join(DIST, 'latest-mac.json'),
  JSON.stringify(feed, null, 2) + '\n',
);
console.log(
  `latest-mac.json for ${version}, signed and verified. Upload the zips, then the feed, to ${BASE_URL}/`,
);
