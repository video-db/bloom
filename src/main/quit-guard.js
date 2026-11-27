const { canStart } = require('../engine/videodb/model');

// True when Bloom can quit or restart without asking: nothing is being captured and the last
// recording's file is on this Mac. Processing continues on the next launch (ADR 0004).
const quitsQuietly = (state) => canStart(state);

// The question asked before quitting while Bloom is capturing or still writing the file:
// that is the only time quitting can cost someone their recording.
function recordingQuitPrompt(state) {
  if (quitsQuietly(state)) return null;
  return {
    type: 'warning',
    buttons: ['Keep Bloom Open', 'Stop and Quit'],
    defaultId: 0,
    cancelId: 0,
    message: 'A recording is still in progress',
    detail:
      'Bloom will stop recording and finish it before it quits. The recording is processed the next time you open Bloom. Quitting before it has finished may lose it.',
  };
}

// How long quitting waits for the recorder when nothing is being captured. Its shutdown can
// take minutes while an earlier recording is failing; quitting must not wait for that.
const QUIET_SHUTDOWN_MS = 4000;

// Settles when `work` does, or after `ms`, whichever comes first. Never rejects.
const settledWithin = (work, ms = QUIET_SHUTDOWN_MS) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    Promise.resolve(work)
      .catch(() => {})
      .then(() => {
        clearTimeout(timer);
        resolve();
      });
  });

// `ask` shows the question and returns the index of the chosen button.
function createQuitGuard({ engine, ask }) {
  let confirmed = false;

  const busy = () => {
    const state = engine.getState();
    return (
      state.phase === 'saving' ||
      (state.pending || []).some((upload) => upload.status === 'uploading')
    );
  };

  return {
    // True when quitting may go ahead. Once confirmed, it is not asked again.
    allows() {
      if (confirmed || !busy()) return true;
      confirmed =
        ask({
          type: 'warning',
          buttons: ['Keep Bloom Open', 'Quit Anyway'],
          defaultId: 0,
          cancelId: 0,
          message: 'Bloom is still processing a recording',
          detail:
            'If you quit now, processing continues the next time you open Bloom.',
        }) === 1;
      return confirmed;
    },
  };
}

module.exports = {
  createQuitGuard,
  recordingQuitPrompt,
  quitsQuietly,
  settledWithin,
};
