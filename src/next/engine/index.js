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
//   library    rename | renameRecording | deleteRecording | restoreRecording | saveDraft |
//              retryRecording
//   versions   saveVersion | renameVersion | deleteVersion
//
// Today only the sample engine exists. The VideoDB-backed engine will implement the same
// surface. Real permission, processing and recovery states must be verified during integration.
const { createSampleEngine } = require('./sample');

function createEngine() {
  return createSampleEngine();
}

module.exports = { createEngine };
