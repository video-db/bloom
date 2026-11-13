// The capture engine is the only part of the new app that talks to capture and VideoDB.
// Everything else (tray, panel, windows) reads one state object and sends named commands:
//
//   getState()            -> state
//   onState(listener)     -> unsubscribe
//   command(name, args)   -> boolean   false when the name is unknown or the arguments are
//                                       malformed; the command did not run
//   dispose()                          stops every timer the engine started
//
// The commands, grouped as the sample engine's files are:
//   capture    start | cancel | stop | pause | resume | mark | setPurpose | retry | keep |
//              answerAsk | trimEnding | newRecording | discard | retryProcessing | simulate
//   sources    setSource | configure | setPermission | checkPermission
//   access     signIn | signOut | checkConnection
//   uploads    resumeUpload | discardUpload
//   library    rename | renameRecording | deleteRecording | restoreRecording | saveDraft |
//              retryRecording
//   versions   saveVersion | renameVersion | deleteVersion
//
// The real VideoDB engine and the sample design engine implement the same surface.
// The main process always selects the real engine; the sample engine backs the main-process tests.
//
// State also carries `capabilities` (see capabilities.js): windows hide what a build cannot do.
const { createSampleEngine } = require('./sample');

function createEngine(options = {}) {
  if (options.mode === 'videodb') {
    const path = require('node:path');
    const { createVideoDBBoundary } = require('./videodb');
    const { createVideoDBEngine } = require('./videodb/engine');
    const { createSDKRecorder } = require('./videodb/recorder');
    const { createRecordingCache } = require('./videodb/cache');
    const { CaptureClient } = require('videodb-capture/capture');
    const service = createVideoDBBoundary(options);
    const recorder = createSDKRecorder({
      CaptureClient,
      service,
      permissionStatus: options.permissionStatus,
    });
    return createVideoDBEngine({
      service,
      recorder,
      cache: createRecordingCache(
        path.join(
          options.dataDir,
          service.apiUrl.includes('.dev.') ? 'videodb-dev' : 'videodb-prod',
          'library.json',
        ),
      ),
    });
  }
  return createSampleEngine(options);
}

module.exports = { createEngine };
