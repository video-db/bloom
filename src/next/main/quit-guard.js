// Asks before quitting while a recording is still being saved or uploaded. Quitting then
// leaves it on this Mac until the next launch, so it must be a choice, not an accident.
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

module.exports = { createQuitGuard };
