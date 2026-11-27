// While a recording's file is being sent, the Mac is kept from going to sleep on its own: the
// file goes as one long request, and sleep would start it again from the beginning. Closing
// the lid still sleeps the Mac. Nothing is held while nothing is being sent.
function createKeepAwake({ blocker }) {
  let id = null;
  const sending = (state) =>
    (state?.recordings || []).some(
      (r) => r.status === 'processing' && r.jobStage === 'sending',
    );
  return {
    observe(state) {
      if (sending(state)) {
        if (id === null || !blocker.isStarted(id))
          id = blocker.start('prevent-app-suspension');
      } else this.release();
    },
    release() {
      if (id !== null && blocker.isStarted(id)) blocker.stop(id);
      id = null;
    },
  };
}

module.exports = { createKeepAwake };
