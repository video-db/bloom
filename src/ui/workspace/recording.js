// One recording in focus: the only recording on screen once opened. Its transcript is the
// reading column; the player, what Bloom knows about it and its marks sit beside it.
import { esc, clock, button } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { meta, status } from './format.js';
import { transcript } from './transcript.js';
import { summary } from './summary.js';

// What can be done with a recording, as tabs. Adding one is an entry here and its view.
export const TABS = [
  { id: 'summary', label: 'Summary', view: summary },
  { id: 'transcript', label: 'Transcript', view: transcript },
];
const tabs = (current) =>
  /* HTML */ `<div class="tabs" role="tablist">
    ${TABS.map(
      (t) =>
        `<button role="tab" class="tab ${t.id === current ? 'on' : ''}" aria-selected="${t.id === current}" data-tab="${t.id}">${t.label}</button>`,
    ).join('')}
  </div>`;

const head = (r) =>
  /* HTML */ `<header class="page-head">
    <h1 title="${esc(r.title)}">${esc(r.title)}</h1>
    <span class="caption"
      >${esc([meta(r), status(r)].filter(Boolean).join(' · '))}</span
    >
    <span class="grow"></span>
    <button
      class="btn"
      data-ui="copy-link"
      data-id="${esc(r.id)}"
      ${!r.playerUrl || r.status !== 'ready' ? 'disabled' : ''}
    >
      Copy link
    </button>
    ${r.readOnly ? '' : menu(r)}
  </header>`;

// Changes to a recording. Not offered for a video from another collection.
const menu = (r) =>
  /* HTML */ `<details class="record-menu">
    <summary aria-label="Recording actions" title="Recording actions">
      •••
    </summary>
    <div>
      <button
        data-dialog="rename"
        data-id="${esc(r.id)}"
        ${r.pendingOperation ? 'disabled' : ''}
      >
        Rename
      </button>
      <button
        data-ui="download"
        data-id="${esc(r.id)}"
        ${r.status !== 'ready' ? 'disabled' : ''}
      >
        Download
      </button>
      <button
        data-copy-transcript="${esc(r.id)}"
        ${r.transcript ? '' : 'disabled'}
      >
        Copy transcript
      </button>
      <button
        class="destructive"
        data-dialog="delete"
        data-id="${esc(r.id)}"
        ${!r.videoId || r.pendingOperation ? 'disabled' : ''}
      >
        Delete…
      </button>
    </div>
  </details>`;

const notices = (r) =>
  `${
    r.pendingOperation
      ? /* HTML */ `<div class="processing-banner" role="status">
          <div><b>Checking the ${esc(r.pendingOperation)}…</b></div>
          ${button('reconcileRecording', 'Check result', `data-id="${esc(r.id)}"`)}
        </div>`
      : ''
  }${
    r.status === 'error'
      ? /* HTML */ `<div class="processing-banner" role="alert">
          <div>
            <b>This recording needs attention</b>
            <p>Your recording is kept. Check it again to finish saving.</p>
          </div>
          ${button('retryRecording', 'Check and retry', `data-id="${esc(r.id)}"`)}
        </div>`
      : ''
  }`;

// What Bloom knows about this recording, in plain words, and how to add to it.
function knowledge(r, signedIn) {
  const unavailable = !r.videoId || !signedIn;
  // A video from another collection is read as it is; Bloom does not transcribe it.
  if (r.readOnly && !r.transcript && r.transcriptStatus !== 'processing')
    return /* HTML */ `<section class="card knows">
      <h2 class="label">What Bloom knows about this recording</h2>
      <div class="knows-row">
        <span>What was said</span><span class="chip">Not transcribed</span>
      </div>
    </section>`;
  const add =
    !r.transcript && !r.transcriptRequested && !['processing', 'error'].includes(r.transcriptStatus);
  const said = r.transcript
    ? '<span class="chip ok">Ready</span>'
    : r.transcriptStatus === 'processing'
      ? '<span class="chip">Preparing…</span>'
      : r.transcriptStatus === 'error' || r.transcriptRequested
        ? `<button class="btn sm" data-command="openRecording" data-id="${esc(r.id)}" ${unavailable ? 'disabled' : ''}>Try again</button>`
        : `<button class="btn sm" data-command="requestTranscript" data-id="${esc(r.id)}" ${unavailable ? 'disabled' : ''}>Add</button>`;
  return /* HTML */ `<section class="card knows">
    <h2 class="label">What Bloom knows about this recording</h2>
    <div class="knows-row"><span>What was said</span>${said}</div>
    ${
      add
        ? '<p class="caption">Preparing a transcript may use VideoDB credits.</p>'
        : ''
    }
  </section>`;
}

const marks = (r) =>
  /* HTML */ `<section class="card" aria-label="Your marks">
    <header class="card-head">
      <span>Your marks</span><span class="caption">${r.marks.length}</span>
    </header>
    ${
      r.marks
        .map(
          (m) =>
            /* HTML */ `<button class="mark-row" data-seek="${m.at}">
              <span class="ts">${clock(m.at)}</span
              ><span>${esc(m.text || 'Marked moment')}</span>
            </button>`,
        )
        .join('') ||
      '<p class="caption card-note">No marks. Press ⇧⌘M while recording to save a moment.</p>'
    }
  </section>`;

const player = (r) =>
  /* HTML */ `<div class="player-card">
    ${
      r.streamUrl
        ? '<video controls preload="metadata" data-player aria-label="Recorded video"></video><p class="caption" data-player-error role="status"></p>'
        : '<div class="player-empty">Playback is not ready yet.</div>'
    }
  </div>`;

const back = (s) =>
  /* HTML */ `<button class="crumb" data-view="recordings">
    ${icon('back')}<span
      >${s.browsing ? esc(s.browsing.name) : 'Recordings'}</span
    >
  </button>`;

// tab: which of TABS is showing.
export function recording(s, id, tab) {
  const r =
    s.recordings.find((item) => item.id === id) ||
    s.browsing?.recordings.find((item) => item.id === id);
  if (!r)
    return /* HTML */ `<section class="page">
      ${back(s)}
      <div class="page-empty">
        <b>This recording is not here any more</b>
        <p>It may have been deleted. Choose another from Recordings.</p>
      </div>
    </section>`;
  const current = TABS.find((t) => t.id === tab) || TABS[0];
  return /* HTML */ `<section class="page recording">
    ${back(s)}${head(r)}${notices(r)}${tabs(current.id)}
    <div class="recording-columns">
      ${current.view(r)}
      <aside class="recording-side" aria-label="Playback and marks">
        ${player(r)}${knowledge(r, s.account.status === 'signed-in')}${marks(r)}
      </aside>
    </div>
  </section>`;
}
