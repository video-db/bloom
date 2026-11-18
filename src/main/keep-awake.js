// Keeps the Mac awake while Bloom has work that sleep would ruin. While recording, the display
// stays on: the recorder stops capturing when the display sleeps, which froze a long recording.
// While a recording's file is being sent, the Mac does not sleep on its own: the file goes as
// one long request, and sleep would start it again from the beginning. Closing the lid still
// sleeps the Mac. Nothing is held otherwise.
const CAPTURING = ['starting', 'recording', 'paused', 'stopping'];

function createKeepAwake({ blocker }) {
  // Without Electron's blocker (a test's stand-in) there is nothing to hold.
  if (!blocker) return { observe() {}, release() {} };
  const held = { 'prevent-display-sleep': null, 'prevent-app-suspension': null };
  const hold = (type, wanted) => {
    const id = held[type];
    if (wanted) {
      if (id === null || !blocker.isStarted(id)) held[type] = blocker.start(type);
    } else if (id !== null) {
      if (blocker.isStarted(id)) blocker.stop(id);
      held[type] = null;
    }
  };
  const sending = (state) =>
    (state?.recordings || []).some(
      (r) => r.status === 'processing' && r.jobStage === 'sending',
    );
  return {
    observe(state) {
      hold('prevent-display-sleep', CAPTURING.includes(state?.phase));
      hold('prevent-app-suspension', sending(state));
    },
    release() {
      hold('prevent-display-sleep', false);
      hold('prevent-app-suspension', false);
    },
  };
}

module.exports = { createKeepAwake };
