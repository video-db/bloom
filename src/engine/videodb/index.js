const path = require('node:path');
const { createVideoDBService, DEV_API, PROD_API } = require('./service');
const { ServiceError } = require('./errors');
const { createCredentialStore } = require('./credentials');
const { createOperationJournal } = require('./journal');

// Compose only in Electron main, after app readiness. Construction makes no network calls.
function createVideoDBBoundary({
  dataDir,
  sdk,
  captureSdk,
  apiUrl = DEV_API,
  timeoutMs,
}) {
  if (![DEV_API, PROD_API].includes(apiUrl))
    throw new ServiceError(
      'invalid-environment',
      'Choose the VideoDB development or production environment.',
    );
  const directory = path.join(
    dataDir,
    apiUrl === DEV_API ? 'videodb-dev' : 'videodb-prod',
  );
  const { connect } = sdk || require('videodb-capture');
  const { CaptureClient } = captureSdk || require('videodb-capture/capture');
  return createVideoDBService({
    connect,
    CaptureClient,
    credentials: createCredentialStore({
      file: path.join(directory, 'credentials.json'),
      legacyFile: path.join(directory, 'key.enc'),
    }),
    journal: createOperationJournal(path.join(directory, 'operations.json')),
    apiUrl,
    timeoutMs,
  });
}

module.exports = { createVideoDBBoundary };
