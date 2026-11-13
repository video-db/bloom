// User preferences for the new interface. Stored as JSON in this entry's own user-data folder.
const fs = require('node:fs');

const DEFAULTS = {
  onboardingComplete: false,
  appearance: 'system', // system | light | dark
  floatingControl: true, // show the recording control on screen while recording
  floatAt: { x: -1, y: -1 }, // where the control was last dragged to; -1 means not yet
  openAtLogin: true, // a menu-bar app that is gone after a restart is confusing; setup shows the switch
  defaultMic: true,
  autoTranscribe: true, // transcribe a new recording once it has been processed
  defaultSystemAudio: false,
  defaultCamera: false,
  askPurpose: true,
  autoSilences: true,
  autoFiller: true,
  autoChapters: true,
  autoCaptions: true,
  notifyLinkReady: true,
  notifyMeetingEnded: true,
  nudgeMinutes: 45, // 0 turns the long-recording reminder off
};

const CHOICES = {
  appearance: ['system', 'light', 'dark'],
  nudgeMinutes: [0, 30, 45, 60],
};

// file: where to persist, or null to keep preferences in memory only (used by automation).
function createPrefs(file) {
  let values = { ...DEFAULTS };
  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const key of Object.keys(DEFAULTS))
        if (valid(key, saved[key])) values[key] = saved[key];
    } catch {
      /* first run or unreadable file: defaults stand */
    }
  }

  function valid(key, value) {
    if (!Object.hasOwn(DEFAULTS, key)) return false;
    if (CHOICES[key]) return CHOICES[key].includes(value);
    if (key === 'floatAt')
      return !!value && Number.isFinite(value.x) && Number.isFinite(value.y);
    return typeof value === typeof DEFAULTS[key];
  }

  return {
    all: () => ({ ...values }),
    set(key, value) {
      if (!valid(key, value)) return false;
      const next = { ...values, [key]: value };
      if (file) {
        try {
          fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
          fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2));
          fs.renameSync(file + '.tmp', file);
        } catch {
          return false;
        }
      }
      values = next;
      return true;
    },
  };
}

module.exports = { createPrefs, DEFAULTS };
