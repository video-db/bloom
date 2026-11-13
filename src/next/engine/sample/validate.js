// Checks command arguments before a command runs. Arguments arrive from renderer
// windows, so a command only ever sees the shapes listed here.
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string';
const id = (value) => text(value) && value.length > 0 && value.length <= 180;
const booleanSources = ['mic', 'systemAudio', 'camera'];
const draft = (value) =>
  object(value) &&
  text(value.text) &&
  object(value.cuts) &&
  ['sil', 'fil', 'cap', 'chap'].every(
    (k) => typeof value.cuts[k] === 'boolean',
  ) &&
  Number.isFinite(value.trim) &&
  value.trim >= 0;
const recipe = (value) =>
  object(value) &&
  ['captions', 'dub', 'voice', 'music', 'vertical', 'short'].includes(
    value.type,
  ) &&
  text(value.option) &&
  value.option.length <= 100 &&
  text(value.prompt) &&
  value.prompt.length <= 500;
const sources = (value) =>
  Array.isArray(value) &&
  value.length <= 100 &&
  value.every(
    (item) =>
      object(item) &&
      id(item.recordingId) &&
      Number.isSafeInteger(item.at) &&
      item.at >= 0 &&
      text(item.text) &&
      item.text.length <= 500,
  );

// Commands that are not listed here take no arguments.
const valid = {
  setSource: (a) =>
    (a.key === 'screen' &&
      ['Display 1', 'Display 2 (sample)'].includes(a.value)) ||
    (booleanSources.includes(a.key) && typeof a.value === 'boolean'),
  signIn: (a) => text(a.key) && a.key.length <= 200,
  resumeUpload: (a) => id(a.id),
  discardUpload: (a) => id(a.id),
  setPurpose: (a) => text(a.text),
  mark: (a) => a.text === undefined || text(a.text),
  answerAsk: (a) => typeof a.stop === 'boolean',
  setPermission: (a) =>
    ['screen', 'mic', 'camera'].includes(a.key) && typeof a.value === 'boolean',
  configure: (a) =>
    object(a.sources) &&
    Object.keys(a.sources).every(
      (k) => booleanSources.includes(k) && typeof a.sources[k] === 'boolean',
    ),
  trimEnding: (a) => typeof a.value === 'boolean',
  rename: (a) => text(a.text),
  renameRecording: (a) => id(a.id) && text(a.text),
  deleteRecording: (a) => id(a.id),
  retryRecording: (a) => id(a.id),
  saveDraft: (a) => id(a.id) && draft(a.draft),
  renameVersion: (a) =>
    id(a.id) &&
    id(a.versionId) &&
    text(a.text) &&
    a.text.trim().length > 0 &&
    a.text.length <= 100,
  deleteVersion: (a) => id(a.id) && id(a.versionId),
  saveVersion: (a) =>
    id(a.id) &&
    object(a.version) &&
    text(a.version.name) &&
    a.version.name.trim().length > 0 &&
    a.version.name.length <= 100 &&
    ['Edit snapshot', 'Search cut', 'Version recipe'].includes(
      a.version.kind,
    ) &&
    draft(a.version.value) &&
    (a.version.recipe === undefined
      ? a.version.kind !== 'Version recipe'
      : a.version.kind === 'Version recipe' && recipe(a.version.recipe)) &&
    (a.version.sources === undefined ||
      (a.version.kind === 'Search cut' && sources(a.version.sources))),
  simulate: (a) =>
    [
      'processing-error',
      'stop-failed',
      'upload-slow',
      'connection',
      'meeting-ended',
      'permission',
      'offline',
      'pending-upload',
    ].includes(a.kind),
};

// True when args is a plain object that the named command accepts.
function validArgs(name, args) {
  return object(args) && (!Object.hasOwn(valid, name) || valid[name](args));
}

module.exports = { validArgs };
