// Sample design sessions remain independently accessible for UI development.
const signedIn = (state) => state.sample || state.account?.status === 'signed-in';
const setupReady = (state, prefs) => state.sample || (
  signedIn(state) && prefs.onboardingComplete && state.permissions.screen &&
  (!state.sources.mic || state.permissions.mic)
);
// Never hide controls needed to stop or recover an existing recording.
const captureActive = (state) => !['idle', 'finished'].includes(state.phase);
const controlsAvailable = (state, prefs) =>
  setupReady(state, prefs) || (prefs.onboardingComplete && captureActive(state));
module.exports = { signedIn, setupReady, captureActive, controlsAvailable };
