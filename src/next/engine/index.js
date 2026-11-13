// The capture engine is the only part of the new app that talks to capture and VideoDB.
// Everything else (tray, panel, windows) reads one state object and sends named commands:
//
//   getState()            -> state
//   onState(listener)     -> unsubscribe
//   command(name, args)   -> void   start | cancel | stop | pause | resume | mark | setSource |
//                                    setPurpose | retry | keep | answerAsk | newRecording |
//                                    discard | checkPermission
//   dispose()
//
// Today only the sample engine exists. The VideoDB-backed engine will implement the same
// surface. Real permission, processing and recovery states must be verified during integration.
const { createMockEngine } = require('./mock');

function createEngine() {
  return createMockEngine();
}

module.exports = { createEngine };
