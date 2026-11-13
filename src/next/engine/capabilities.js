// What a build can actually do. Windows hide what is not available instead of showing a
// control that does nothing, so every engine reports its capabilities in its state.
const EVERYTHING = {
  editing: true, // text cuts, suggested edits, the timeline, saving a version
  versions: true, // dub, vertical, voice, music and short recipes
  searchCuts: true, // a cut built from moments found across recordings
  askToEdit: true, // the free-form request bar
  liveTranscript: true, // spoken lines shown while recording
  meetingPrompt: true, // offering to stop when a meeting ends
  camera: false, // capture does not support cameras yet
};

const SCOPES = {
  // Everything designed so far, for design work on the sample engine.
  full: EVERYTHING,
  // The first release: record, play, link, transcript and library.
  v1: Object.fromEntries(Object.keys(EVERYTHING).map((key) => [key, false])),
};

function capabilitiesFor(scope = 'full') {
  return { ...(SCOPES[scope] || SCOPES.full) };
}

module.exports = { capabilitiesFor };
