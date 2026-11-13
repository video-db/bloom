// Asks before quitting while a recording is still being saved or uploaded. Quitting then
// leaves it on this Mac until the next launch, so it must be a choice, not an accident.
function recordingQuitPrompt(state) {
  if (['idle', 'finished'].includes(state.phase) && !state.pending.length)
    return null;
  const retained = ['idle', 'finished', 'processing-error'].includes(
    state.phase,
  );
  return {
    type: 'warning',
    buttons: ['Keep Bloom Open', retained ? 'Quit Bloom' : 'Stop and Quit'],
    defaultId: 0,
    cancelId: 0,
    message: retained
      ? 'A recording still needs attention'
      : 'A recording is still active or being saved',
    detail: retained
      ? 'Bloom will keep any retained recording files on this Mac. Reopen Bloom to check the recording status and retry failed uploads.'
      : 'Bloom must confirm capture has stopped and finalize media before quitting. Complete pending files can upload after you reopen Bloom. Incomplete media is not guaranteed recoverable.',
  };
}

// True when nothing is being captured or finalised, so Bloom can restart without asking:
// a retained upload stays on this Mac and is picked up on the next launch, as always.
const restartsQuietly = (state) =>
  ['idle', 'finished', 'processing-error'].includes(state.phase);

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
          message: 'Bloom is still uploading a recording',
          detail:
            'If you quit now, the recording stays on this Mac and the upload continues the next time you open Bloom.',
        }) === 1;
      return confirmed;
    },
  };
}

module.exports = { createQuitGuard, recordingQuitPrompt, restartsQuietly };
