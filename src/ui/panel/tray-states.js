// The tray panel while a session exists: starting, recording, paused, stopping, saving,
// finished, and the two states that need attention. The header carries the state; the body
// holds only what can be done about it.
import { esc, clock, button } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { mark } from '../shared/mark.js';
import { sources } from './sources.js';

// Plain words for where a saved recording has got to.
const STAGE_WORDS = {
  finalizing: 'Finalising',
  awaiting_token: 'Waiting to upload',
  uploading: 'Uploading',
  processing: 'Processing',
  playback: 'Preparing playback',
  'paused-upload': 'Upload paused',
  'start-unknown': 'Needs checking',
  failed: 'Upload failed',
};
export const stageWords = (stage) => STAGE_WORDS[stage] || 'Saving';

const current = (s) => s.recordings.find((r) => r.sessionId === s.sessionId);

// ---- header: says the state at a glance ----
const headers = {
  starting: () => `<span class="brandname">${mark('busy')} Starting</span>`,
  recording: (s) =>
    `<span class="tray-live">${mark('rec')}<span class="timer" data-clock>${clock(s.elapsed)}</span><span class="mid">Recording</span></span>`,
  paused: (s) =>
    `<span class="tray-live">${icon('pause')}Paused at <span data-clock>${clock(s.elapsed)}</span></span>`,
  stopping: () => `<span class="brandname">${mark('busy')} Stopping</span>`,
  stopped: () =>
    `<span class="tray-live">${icon('warning')}Capture needs attention</span>`,
  saving: (s) =>
    `<span class="brandname">${mark('busy')} Saving ${clock(s.elapsed)}</span>`,
  'processing-error': () =>
    `<span class="tray-live">${icon('warning')}Saving needs attention</span>`,
};
export const stateHeader = (s) => headers[s.phase]?.(s) || '';
export const attention = (s) =>
  ['paused', 'stopped', 'processing-error'].includes(s.phase);

// ---- bodies ----
const marks = (s) =>
  s.marks.length
    ? s.marks
        .map(
          (m) =>
            /* HTML */ `<div class="mk">
              <span class="ts">${clock(m.at)}</span
              >${m.text ? esc(m.text) : '<span class="soft">Marked</span>'}
            </div>`,
        )
        .join('')
    : '<span class="soft tray-small">None yet. Press ⇧⌘M or type a note.</span>';

const recording = (s) =>
  /* HTML */ `${sources(s, { locked: true })}
    <span class="label">Your marks</span>
    <div class="tray-marks">${marks(s)}</div>
    <form data-form="mark">
      <input
        class="field"
        name="note"
        data-focus="note"
        maxlength="500"
        placeholder="Type a note. ↵ marks this moment"
        aria-label="Mark a moment"
      />
    </form>
    <div class="row3">
      <button class="btn quiet" data-command="pause">
        ${icon('pause')} Pause</button
      ><button class="btn quiet" data-command="mark">
        ${icon('mark')} Mark</button
      ><button class="btn pri" data-command="stop" aria-label="Stop recording">
        ${icon('stop')} Stop
      </button>
    </div>`;

const paused = (s) =>
  /* HTML */ `${sources(s, { locked: true })}
    <p>
      <b>Nothing is being captured.</b><br /><span class="soft"
        >What you recorded so far is kept. Resume when you’re ready.</span
      >
    </p>
    <div class="row2">
      <button class="btn pri" data-command="resume">Resume</button
      ><button
        class="btn quiet"
        data-command="stop"
        aria-label="Stop recording"
      >
        ${icon('stop')} Stop
      </button>
    </div>`;

// One card for the recording being saved: its three steps, and which one it is on.
function saving(s) {
  const record = current(s);
  const stage = s.upload?.stage || record?.jobStage || 'finalizing';
  const step = ['processing', 'playback'].includes(stage)
    ? 2
    : stage === 'finalizing'
      ? 0
      : 1;
  const steps = ['Finalise', 'Upload', 'Process']
    .map(
      (name, index) =>
        `<div class="${index < step ? 'done' : index === step ? 'now' : ''}"><b>${name}</b>${index < step ? 'done' : index === step ? 'now…' : 'next'}</div>`,
    )
    .join('');
  return /* HTML */ `<div class="tray-card">
      <span class="shot"></span>
      <span class="rc-copy"
        ><b>${esc(record?.title || 'Your recording')}</b
        ><small>${clock(s.elapsed)} · ${stageWords(stage)}</small></span
      >
    </div>
    <div class="stages" role="status" aria-label="Saving: ${stageWords(stage)}">
      ${steps}
    </div>
    <p class="soft tray-small">
      Not recording. Keep Bloom open until this finishes; the link appears here.
    </p>`;
}

const finished = (s) =>
  /* HTML */ `<div class="tray-card">
      <span class="shot"></span>
      <span class="rc-copy"
        ><b>${esc(s.result.title)}</b
        ><small>${clock(s.result.duration)} · Ready to play</small></span
      >
    </div>
    <div class="row2">
      <button class="btn" data-ui="copy-link" data-id="${esc(s.result.id)}">
        Copy link</button
      ><button
        class="btn"
        data-ui="open-main"
        data-view="detail"
        data-id="${esc(s.result.id)}"
      >
        Open recording
      </button>
    </div>`;

function needsCheck(s) {
  const record = current(s);
  return /* HTML */ `<p>
      <b>This recording needs checking.</b><br /><span class="soft"
        >It is kept on this Mac. Checking again looks for the saved copy.</span
      >
    </p>
    <div class="row2">
      ${
        record
          ? button(
              'retryRecording',
              'Check again',
              `data-id="${esc(record.id)}"`,
            )
          : ''
      }${button('newRecording', 'Record again')}
    </div>`;
}

const bodies = {
  starting: () =>
    '<p><b>Not recording yet.</b><br /><span class="soft">Bloom is opening your screen and sound.</span></p>',
  recording,
  paused,
  stopping: () =>
    '<p><b>Stopping.</b><br /><span class="soft">Waiting for the recorder to confirm. Keep Bloom open.</span></p>',
  stopped: () =>
    /* HTML */ `<p>
        <b>Bloom couldn’t confirm the recording stopped.</b><br /><span
          class="soft"
          >It may still be capturing. Stop it before starting another.</span
        >
      </p>
      ${button('stop', 'Try Stop again')}`,
  saving,
  'processing-error': needsCheck,
};
// The body for a state, or '' when the ready controls should show instead.
export const stateBody = (s) => bodies[s.phase]?.(s) || '';
export const resultCard = (s) => (s.result ? finished(s) : '');

// Recordings from earlier sessions that have not finished saving. The one being saved
// right now has its own card above, so it is left out here.
export function pending(s) {
  const active = s.phase === 'saving' ? current(s)?.id : null;
  const others = s.pending.filter((p) => p.id !== active);
  if (!others.length) return '';
  return /* HTML */ `<span class="label">Still saving</span> ${others
      .map(
        (p) =>
          /* HTML */ `<div class="tray-card">
            <span class="shot"></span>
            <span class="rc-copy"
              ><b>${esc(p.title)}</b><small>${stageWords(p.stage)}</small></span
            >
            ${
              p.status === 'failed'
                ? `<button class="btn sm" data-command="resumeUpload" data-id="${esc(p.id)}">Retry</button>`
                : ''
            }
          </div>`,
      )
      .join('')}`;
}
