// Starting after an update. Builds are not yet signed with a stable certificate, so macOS
// ties Screen Recording to each build's own signature and forgets it at every update, while
// System Settings goes on showing Bloom ticked. Bloom clears its own stale entry so the
// permissions step can ask afresh, and setup says why. Remove once builds keep one signature.
const { execFile } = require('node:child_process');

const BUNDLE_ID = 'com.videodb.bloom';

// True when this launch follows an update and Screen Recording no longer works, after
// clearing the stale entry. The version run last is noted either way.
function afterUpdate({
  version,
  prefs,
  packaged,
  screenStatus,
  reset = resetScreen,
}) {
  const { lastVersion, onboardingComplete } = prefs.all();
  if (lastVersion !== version) prefs.set('lastVersion', version);
  // A version from before this was noted counts as different, once setup has been done.
  const updated = onboardingComplete && lastVersion !== version;
  if (!updated || !packaged || screenStatus() === 'granted') return false;
  reset();
  return true;
}

// Only Bloom's own entry, and only Screen Recording. Needs no administrator rights.
function resetScreen() {
  execFile('/usr/bin/tccutil', ['reset', 'ScreenCapture', BUNDLE_ID], () => {});
}

module.exports = { afterUpdate, BUNDLE_ID };
