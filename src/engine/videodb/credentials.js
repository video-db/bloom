const fs = require('node:fs');
const { atomicWrite } = require('./files');
const { ServiceError } = require('./errors');

// Local persistence is intentional for this internal build; see architecture ADR 0003.
// Version 1 holds a pasted API key. Version 2 adds a browser sign-in: the console's token, the
// VideoDB user it belongs to, and when it runs out.
const validSecret = (value) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
const validUser = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= 200;

function parse(saved) {
  if (saved?.version === 1 && validSecret(saved.apiKey))
    return { kind: 'key', secret: saved.apiKey.trim() };
  if (
    saved?.version === 2 &&
    saved.kind === 'token' &&
    validSecret(saved.token) &&
    validUser(saved.userId) &&
    (saved.expiresAt === null || Number.isFinite(saved.expiresAt))
  )
    return {
      kind: 'token',
      secret: saved.token,
      userId: saved.userId,
      expiresAt: saved.expiresAt,
    };
  throw new Error('unreadable');
}

function createCredentialStore({ file, legacyFile }) {
  const save = (record, message) => {
    try {
      atomicWrite(file, JSON.stringify(record));
    } catch {
      throw new ServiceError('credential-storage', message);
    }
  };
  return {
    // The saved credential, { kind, secret, userId?, expiresAt? }, or null.
    readCredential() {
      try {
        return parse(JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new ServiceError(
          'credential-storage',
          'Your saved sign-in could not be read. Enter your API key again.',
        );
      }
    },
    read() {
      return this.readCredential()?.secret || null;
    },
    write(apiKey) {
      if (!validSecret(apiKey))
        throw new ServiceError('invalid-input', 'Enter a VideoDB API key.');
      save(
        { version: 1, apiKey: apiKey.trim() },
        'Your API key could not be saved. Check disk space and file permissions, then try again.',
      );
    },
    writeToken({ token, userId, expiresAt = null }) {
      if (!validSecret(token) || !validUser(userId))
        throw new ServiceError('invalid-input', 'Sign in with VideoDB again.');
      save(
        { version: 2, kind: 'token', token, userId, expiresAt },
        'Your sign-in could not be saved. Check disk space and file permissions, then try again.',
      );
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
