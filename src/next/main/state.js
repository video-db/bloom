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
}) {
  let prefError = ''; // why the last preference save failed; windows show it until one succeeds

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
  });

  function broadcast(state) {
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
  };
}

module.exports = { createAppState };
