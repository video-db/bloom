// Bloom's own code-signing certificate. Builds signed with it share one designated
// requirement (the certificate, not a build's hash), so macOS keeps Screen Recording,
// Microphone and Camera across updates and whichever copy of Bloom it finds. It is
// self-signed: no Apple account, and no notarisation.
//
// Create it once, on the Mac that builds releases:   node build/signing-identity.js
// Everything lives in ~/Library/Application Support/bloom-release/ (mode 700): a keychain
// of its own holding the certificate and key, its password, and a .p12 backup with its
// password. Keep a copy of that folder somewhere safe and never commit it: a new
// certificate means every Mac grants Bloom's permissions once more.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOME = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'bloom-release',
);
const KEYCHAIN = path.join(HOME, 'bloom-signing.keychain-db');
const PASSWORD = path.join(HOME, 'bloom-signing.password');
const BACKUP = path.join(HOME, 'bloom-signing.p12');
const BACKUP_PASSWORD = path.join(HOME, 'bloom-signing.p12.password');
const NAME = 'Bloom Release Signing';

const security = (...args) =>
  execFileSync('/usr/bin/security', args, { stdio: 'pipe' }).toString();

// The identity to sign with, or null when this Mac has none (builds are then ad hoc).
function signingIdentity() {
  if (!fs.existsSync(KEYCHAIN) || !fs.existsSync(PASSWORD)) return null;
  const password = fs.readFileSync(PASSWORD, 'utf8').trim();
  security('unlock-keychain', '-p', password, KEYCHAIN);
  // The certificate's SHA-1: what codesign is given, so the name can never be ambiguous.
  const listing = security('find-identity', '-p', 'codesigning', KEYCHAIN);
  const match = listing.match(new RegExp(`([0-9A-F]{40}) "${NAME}"`));
  if (!match) throw new Error(`No "${NAME}" identity in ${KEYCHAIN}.`);
  return { hash: match[1], keychain: KEYCHAIN };
}

function create() {
  if (fs.existsSync(KEYCHAIN)) {
    console.log(`Kept: ${KEYCHAIN} already exists.`);
    return;
  }
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-signing-'));
  try {
    const key = path.join(work, 'key.pem');
    const cert = path.join(work, 'cert.pem');
    const config = path.join(work, 'cert.cnf');
    fs.writeFileSync(
      config,
      [
        '[req]',
        'distinguished_name = dn',
        'x509_extensions = ext',
        'prompt = no',
        '[dn]',
        `CN = ${NAME}`,
        'O = VideoDB',
        '[ext]',
        'basicConstraints = critical, CA:false',
        'keyUsage = critical, digitalSignature',
        'extendedKeyUsage = critical, codeSigning',
        'subjectKeyIdentifier = hash',
      ].join('\n'),
    );
    // The system openssl, whose .p12 files the macOS keychain reads without complaint.
    execFileSync(
      '/usr/bin/openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:3072',
        '-nodes',
        '-sha256',
        '-days',
        '7300',
        '-keyout',
        key,
        '-out',
        cert,
        '-config',
        config,
      ],
      { stdio: 'pipe' },
    );
    const p12Password = crypto.randomBytes(24).toString('base64url');
    execFileSync(
      '/usr/bin/openssl',
      [
        'pkcs12',
        '-export',
        '-inkey',
        key,
        '-in',
        cert,
        '-name',
        NAME,
        '-out',
        BACKUP,
        '-passout',
        `pass:${p12Password}`,
      ],
      { stdio: 'pipe' },
    );
    fs.chmodSync(BACKUP, 0o600);
    fs.writeFileSync(BACKUP_PASSWORD, `${p12Password}\n`, { mode: 0o600 });
    const password = crypto.randomBytes(24).toString('base64url');
    fs.writeFileSync(PASSWORD, `${password}\n`, { mode: 0o600 });
    // A keychain of its own: never added to the search list, never locks by itself.
    security('create-keychain', '-p', password, KEYCHAIN);
    security('set-keychain-settings', KEYCHAIN);
    security('unlock-keychain', '-p', password, KEYCHAIN);
    security(
      'import',
      BACKUP,
      '-k',
      KEYCHAIN,
      '-P',
      p12Password,
      '-T',
      '/usr/bin/codesign',
    );
    // codesign may use the key without asking each time.
    security(
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      password,
      KEYCHAIN,
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true }); // the bare key never stays on disk
  }
  const { hash } = signingIdentity();
  console.log(
    `Created "${NAME}" (${hash}) in ${KEYCHAIN}. Back up ${HOME}; never commit it.`,
  );
}

// codesign finds an identity only in a keychain on the search list, even when told which
// keychain to use. The signing keychain joins the list for the signing and leaves it after,
// putting the list back exactly as it was.
async function withSigningKeychain(work) {
  const before = security('list-keychains', '-d', 'user')
    .split('\n')
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  security('list-keychains', '-d', 'user', '-s', ...before, KEYCHAIN);
  try {
    return await work();
  } finally {
    security('list-keychains', '-d', 'user', '-s', ...before);
  }
}

module.exports = { signingIdentity, withSigningKeychain, NAME };
if (require.main === module) create();
