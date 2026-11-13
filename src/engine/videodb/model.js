const { capabilitiesFor } = require('../capabilities');

function initialState() {
  return {
    sample: false,
    capabilities: capabilitiesFor('v1'),
    account: { status: 'signed-out', label: '' }, // signed-out | checking | signed-in | invalid | offline
    recorder: { status: 'idle', message: '' }, // idle | preparing | ready | failed
    online: true,
    phase: 'idle',
    sessionId: null,
    elapsed: 0,
    purpose: '',
    sources: {
      screen: '',
      mic: true,
      microphone: '',
      systemAudio: false,
      camera: false,
      window: '', // the id of a single window to record instead of the display
    },
    channels: { displays: [], mics: [], systemAudio: [] },
    muted: { mic: false, systemAudio: false }, // a sound source silenced during this recording
    windowHidden: false, // a recorded window is blanked with a plain card for now
    windows: { supported: false, list: [] }, // open windows: [{ id, app, title, width, height }]
    permissions: { screen: false, mic: false, camera: false },
    recordings: [],
    collections: [], // [{ id, name, bloom }] from VideoDB
    credits: null, // VideoDB credit balance, once known
    browsing: null, // another collection being looked at: { id, name, status, recordings }
    search: { query: '', status: 'idle', results: [] },
    recent: [],
    pending: [],
    marks: [],
    moments: [],
    live: [],
    trim: 0,
    upload: null,
    result: null,
    problem: null,
    notice: '',
    busy: false,
  };
}

function newRecord({ id, sessionId, title, duration = 0, marks = [] }) {
  return {
    id,
    sessionId,
    title: title || 'Untitled recording',
    duration,
    marks,
    createdAt: Date.now(),
    status: 'processing',
    jobStage: 'finalizing',
    transcript: '',
    transcriptStatus: 'not-requested',
    trim: 0,
    silence: 0,
    filler: 0,
    chips: [],
  };
}

// A recording Bloom made that VideoDB does not have yet.
const unfinished = (r) => !r.videoId && r.status !== 'ready';

// True when a new recording may start: nothing is being captured, and the last recording's
// file, if there is one, is safely on this Mac (it has a recorder id). What happens to that
// file afterwards is background work and never stands in the way (ADR 0004).
function canStart(state) {
  if (['idle', 'finished', 'processing-error'].includes(state.phase))
    return true;
  if (state.phase !== 'saving') return false;
  return !!state.recordings.find((r) => r.sessionId === state.sessionId)
    ?.recordingId;
}

// The name a recording gets until someone renames it: when it was made.
function datedTitle(date) {
  const day = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Recording · ${day}, ${time}`;
}

function pending(records) {
  return records
    .filter((r) => r.recordingId && !r.videoId)
    .map((r) => ({
      id: r.id,
      title: r.title,
      duration: r.duration,
      stage: r.jobStage,
      status:
        r.status === 'error' ? 'failed' : r.paused ? 'waiting' : 'processing',
      progress: r.progress ?? null,
    }));
}

module.exports = {
  initialState,
  newRecord,
  datedTitle,
  pending,
  unfinished,
  canStart,
};
