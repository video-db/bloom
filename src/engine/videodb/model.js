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
    },
    channels: { displays: [], mics: [], systemAudio: [] },
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
        r.status === 'error'
          ? 'failed'
          : ['uploading', 'processing'].includes(r.jobStage)
            ? 'uploading'
            : 'waiting',
      progress: r.progress ?? null,
    }));
}

module.exports = { initialState, newRecord, datedTitle, pending };
