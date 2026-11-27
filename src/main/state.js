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
  floating = null,
  loginSupported = false,
  version = '',
  livePreviews = false,
  updated = false, // started after an update with Screen Recording no longer on
  syncMenu = () => {},
}) {
  let prefError = ''; // why the last preference save failed; windows show it until one succeeds
  let hint = ''; // 'first-recording' from the end of setup until a recording starts
  let update; // what the updater says for Settings; none in a build that does not update

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
      autoTranscribe: p.autoTranscribe,
    });
  }

  const withPrefs = (state) => ({
    ...state,
    prefs: prefs.all(),
    prefError,
    loginSupported,
    version,
    livePreviews, // onboarding may show the screen and microphone working
    updated,
    hint,
    ...(update ? { update } : {}),
  });

  function broadcast(state) {
    if (hint && !['idle', 'finished'].includes(state.phase)) hint = '';
    tray.setAvailable(controlsAvailable(state, prefs.all()));
    syncMenu(state);
    windows.syncAccess(state);
    tray.paint(state);
    notifications.observe(state);
    windows.send('bloom:state', withPrefs(state));
    floating?.sync(state);
    floating?.send('bloom:state', withPrefs(state));
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
    setUpdate(value) {
      update = value;
    },
  };
}

module.exports = { createAppState };
