// The tray panel while a session exists: starting, recording, paused, stopping and the short
// moment a file is being finished; then the cards for recordings that are being processed or
// need recovery. The header carries the state; the body holds only what can be done about it.
import { esc, clock, button } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { mark } from '../shared/mark.js';
import { sources, windowControls } from './sources.js';
import { stage, stageLine, progressBar } from '../shared/stage.js';

const current = (s) => s.recordings.find((r) => r.sessionId === s.sessionId);

// True once a new recording may start: nothing is being captured and the last recording's
// file is on this Mac. Mirrors the engine's rule; processing never stands in the way.
export const canStart = (s) =>
  ['idle', 'finished', 'processing-error'].includes(s.phase) ||
  (s.phase === 'saving' && !!current(s)?.recordingId);

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
    `<span class="brandname">${mark('busy')} Processing ${clock(s.elapsed)}</span>`,
};
// Once a new recording can start, the header is Bloom's own again.
export const stateHeader = (s) =>
  canStart(s) ? '' : headers[s.phase]?.(s) || '';
export const attention = (s) => ['paused', 'stopped'].includes(s.phase);

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
  /* HTML */ `${sources(s, { locked: true })}${windowControls(s)}
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
  /* HTML */ `${sources(s, { locked: true })}${windowControls(s)}
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

// A recording that is not ready yet: what it is doing and how far along. Nothing to press:
// Bloom carries on by itself, and tries again when the connection allows.
const card = (r) =>
  /* HTML */ `<div class="tray-card">
    <span class="shot"></span>
    <span class="rc-copy"
      ><b>${esc(r.title)}</b
      ><small>${clock(r.duration)} · ${esc(r.paused ? 'Waiting' : stageLine(r))}</small
      >${progressBar(stage(r).progress)}</span
    >
  </div>`;

// The few seconds after Stop while the file is being finished.
const finishing = (s) =>
  /* HTML */ `${card({
      title: current(s)?.title || 'Your recording',
      duration: s.elapsed,
    })}
    <p class="soft tray-small" role="status">
      Finishing your recording. Keep Bloom open for a moment.
    </p>`;

const finished = (s) =>
  /* HTML */ `<div class="tray-card">
      <span class="shot"></span>
      <span class="rc-copy"
        ><b>${esc(s.result.title)}</b
        ><small
          >${clock(s.result.duration)} · Ready to play${
            s.recordings.find((r) => r.id === s.result.id)?.transcriptStatus ===
            'processing'
              ? ' · Understanding'
              : ''
          }</small
        ></span
      >
    </div>
    <div class="row2">
      <button class="btn" data-ui="copy-link" data-id="${esc(s.result.id)}">
        Copy link</button
      ><button class="btn" data-ui="open-main" data-id="${esc(s.result.id)}">
        Open recording
      </button>
    </div>`;

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
  saving: finishing,
};
// The body for a state, or '' when the ready controls should show instead.
export const stateBody = (s) => (canStart(s) ? '' : bodies[s.phase]?.(s) || '');
export const resultCard = (s) => (s.result ? finished(s) : '');

// The recording just made, while it is processed or if it needs recovery. It sits where the
// finished card will appear.
export function currentCard(s) {
  const record = current(s);
  if (!record || !['saving', 'processing-error'].includes(s.phase)) return '';
  return card({ ...record, duration: record.duration || s.elapsed });
}

// Earlier recordings that are not ready yet, in two groups.
export function pending(s) {
  const shown = ['saving', 'processing-error'].includes(s.phase)
    ? current(s)?.id
    : null;
  const others = s.pending
    .filter((p) => p.id !== shown)
    .map((p) => ({
      ...p,
      jobStage: p.stage,
      status: p.status === 'failed' ? 'error' : 'processing',
      paused: p.status === 'waiting',
    }));
  const group = (label, items) =>
    items.length
      ? `<span class="label">${label}</span>${items.map(card).join('')}`
      : '';
  const waiting = (p) => p.jobStage === 'waiting-connection';
  return `${group(
    'Processing',
    others.filter((p) => p.status !== 'error' && !waiting(p)),
  )}${group('Waiting for a better connection', others.filter(waiting))}${group(
    'Can’t be processed',
    others.filter((p) => p.status === 'error'),
  )}`;
}
