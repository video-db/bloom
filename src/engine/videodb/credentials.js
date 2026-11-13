const fs = require('node:fs');
const { atomicWrite } = require('./files');
const { ServiceError } = require('./errors');

// Local persistence is intentional for this internal build; see architecture ADR 0003.
function createCredentialStore({ file, legacyFile }) {
  const validKey = (key) =>
    typeof key === 'string' && key.trim().length > 0 && key.length <= 4096;
  return {
    read() {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved?.version !== 1 || !validKey(saved.apiKey)) throw new Error();
        return saved.apiKey.trim();
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new ServiceError(
          'credential-storage',
          'Your saved sign-in could not be read. Enter your API key again.',
        );
      }
    },
    write(apiKey) {
      if (!validKey(apiKey))
        throw new ServiceError('invalid-input', 'Enter a VideoDB API key.');
      try {
        atomicWrite(
          file,
          JSON.stringify({ version: 1, apiKey: apiKey.trim() }),
        );
      } catch {
        throw new ServiceError(
          'credential-storage',
          'Your API key could not be saved. Check disk space and file permissions, then try again.',
        );
      }
    },
    clear() {
      try {
        for (const target of [file, legacyFile].filter(Boolean))
          fs.rmSync(target, { force: true });
      } catch {
        throw new ServiceError(
          'credential-storage',
          'Your saved sign-in could not be removed. Try again.',
        );
      }
    },
  };
}

module.exports = { createCredentialStore };
