// The key that signs Bloom's update feed. Run once on the Mac that builds releases:
//   node build/update-key.js
// It creates the private key outside the repository (never commit it, and keep a copy
// somewhere safe: a lost key means the next update must be installed by hand), and prints
// the public key that src/main/update-key.js must hold.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KEY_FILE =
  process.env.BLOOM_UPDATE_KEY ||
  path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'bloom-release',
    'update-signing-key.pem',
  );

if (require.main === module) {
  if (fs.existsSync(KEY_FILE)) {
    console.log(`A key already exists at ${KEY_FILE}; it is kept.`);
  } else {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      KEY_FILE,
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { mode: 0o600, flag: 'wx' },
    );
    console.log(`Private key written to ${KEY_FILE} (mode 600).`);
  }
  const publicKey = crypto
    .createPublicKey(fs.readFileSync(KEY_FILE))
    .export({ type: 'spki', format: 'pem' });
  console.log('Public key for src/main/update-key.js:\n' + publicKey);
}

module.exports = { KEY_FILE };
