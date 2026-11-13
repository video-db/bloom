const fs = require('node:fs');
const { atomicWrite } = require('./files');
const { ServiceError } = require('./errors');

// Call after Electron is ready; an unavailable keychain never falls back to plaintext.
function createCredentialStore({ file, safeStorage }) {
  const available = () => {
    if (
      !safeStorage?.isEncryptionAvailable() ||
      safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    )
      throw new ServiceError(
        'secure-storage',
        'Secure credential storage is unavailable. Unlock your keychain and try again.',
      );
  };
  return {
    read() {
      if (!fs.existsSync(file)) return null;
      available();
      try {
        return safeStorage.decryptString(fs.readFileSync(file));
      } catch {
        throw new ServiceError(
          'secure-storage',
          'The saved credential could not be opened. Reconnect your account.',
        );
      }
    },
    write(apiKey) {
      available();
      if (typeof apiKey !== 'string' || !apiKey.trim())
        throw new ServiceError('invalid-input', 'Enter a VideoDB API key.');
      try {
        atomicWrite(file, safeStorage.encryptString(apiKey));
      } catch {
        throw new ServiceError(
          'secure-storage',
          'The credential could not be saved securely. Check disk space and try again.',
        );
      }
    },
    clear() {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        throw new ServiceError(
          'secure-storage',
          'The saved credential could not be removed. Try again.',
        );
      }
    },
  };
}

module.exports = { createCredentialStore };
