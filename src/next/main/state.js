const { controlsAvailable } = require('./access');
// The state flow: every engine change reaches the tray, the notifications and each open window,
// joined with preferences. Also applies the preferences that change the app itself.
function createAppState({
  engine,
  prefs,
  theme,
  tray,
  notifications,
  windows,
  loginSupported = false,
  livePreviews = false,
  syncMenu = () => {},
}) {
  let prefError = ''; // why the last preference save failed; windows show it until one succeeds
  let hint = ''; // 'first-recording' from the end of setup until a recording starts

  // Preferences that change the app itself rather than a window.
  function applyPrefs() {
    const p = prefs.all();
    theme.follow(p.appearance);
    engine.command('configure', {
      sources: {
        mic: p.defaultMic,
        systemAudio: p.defaultSystemAudio,
        camera: p.defaultCamera,
      },
    });
  }

  const withPrefs = (state) => ({
    ...state,
    prefs: prefs.all(),
    prefError,
    loginSupported,
    livePreviews, // onboarding may show the screen and microphone working
    hint,
  });

  function broadcast(state) {
    if (hint && !['idle', 'finished'].includes(state.phase)) hint = '';
    tray.setAvailable(controlsAvailable(state, prefs.all()));
    syncMenu(state);
    windows.syncAccess(state);
    tray.paint(state);
    notifications.observe(state);
    windows.send('next:state', withPrefs(state));
  }

  return {
    applyPrefs,
    withPrefs,
    broadcast,
    setPrefError(message) {
      prefError = message;
    },
    setHint(value) {
      hint = value;
    },
  };
}

module.exports = { createAppState };
