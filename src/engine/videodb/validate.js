const text = (value, limit) =>
  typeof value === 'string' && value.length <= limit;
const id = (value) => text(value, 180) && value.length > 0;
const none = (args) => Object.keys(args).length === 0;
const commandArgs = {
  signIn: (a) => text(a.key, 4096) && !!a.key.trim(),
  signOut: none,
  checkConnection: none,
  refresh: none,
  checkPermission: none,
  prepareRecorder: none,
  start: none,
  stop: none,
  pause: none,
  resume: none,
  newRecording: none,
  setPermission: (a) =>
    ['screen', 'mic'].includes(a.key) && typeof a.value === 'boolean',
  setSource: (a) =>
    ['screen', 'microphone'].includes(a.key)
      ? id(a.value)
      : ['mic', 'systemAudio'].includes(a.key) && typeof a.value === 'boolean',
  configure: (a) =>
    a.sources &&
    typeof a.sources === 'object' &&
    !Array.isArray(a.sources) &&
    Object.entries(a.sources).every(
      ([key, value]) =>
        ['mic', 'systemAudio', 'camera'].includes(key) &&
        typeof value === 'boolean',
    ),
  setPurpose: (a) => text(a.text, 180),
  mark: (a) => a.text === undefined || text(a.text, 500),
  openRecording: (a) => id(a.id),
  openCollection: (a) => id(a.id),
  closeCollection: none,
  search: (a) => text(a.text, 300),
  renameRecording: (a) => id(a.id) && text(a.text, 180) && !!a.text.trim(),
  deleteRecording: (a) => id(a.id),
  reconcileRecording: (a) => id(a.id),
  requestTranscript: (a) => id(a.id),
  retryRecording: (a) => id(a.id),
  resumeUpload: (a) => id(a.id),
};

function validCommand(name, args) {
  return (
    typeof name === 'string' &&
    Object.hasOwn(commandArgs, name) &&
    args !== null &&
    typeof args === 'object' &&
    !Array.isArray(args) &&
    commandArgs[name](args)
  );
}

module.exports = { validCommand };
