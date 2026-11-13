// What opens at launch. Setup is for the first run, or for when something is really
// pending; a returning person should get the tray, not the setup window.
async function openFirstWindow({ engine, prefs, windows, flag }) {
  const returning = flag('skip-onboarding') || prefs.all().onboardingComplete;
  if (returning) {
    // The saved key is still being checked right after launch. Deciding before the answer
    // arrives looks like "signed out" and would show setup on every launch.
    await engine.ready;
    // Opens the panel, or setup at the pending step if the key or a permission needs attention.
    windows.showPanel();
  } else {
    if (engine.getState().sample) {
      engine.command('setPermission', { key: 'screen', value: false });
      engine.command('setPermission', { key: 'mic', value: false });
    }
    windows.openOnboarding();
  }
  if (flag('open-preferences')) windows.openMain('settings');
  else if (flag('open-main')) windows.openMain('library');
}

module.exports = { openFirstWindow };
