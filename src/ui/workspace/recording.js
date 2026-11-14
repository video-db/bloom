// One recording in focus, for watching: the video is the main thing, with its playbar and
// a timeline of chapters and marks under it; the summary, transcript and marks are a column
// beside it, and every time in them jumps the video.
import { esc, clock, button } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { meta, status } from './format.js';
import { transcript } from './transcript.js';
import { summary } from './summary.js';
import { timeline } from './timeline.js';

// What can be done with a recording, as tabs. Adding one is an entry here and its view.
export const TABS = [
  { id: 'summary', label: 'Summary', view: summary },
  { id: 'transcript', label: 'Transcript', view: transcript },
  { id: 'marks', label: 'Marks', view: marks },
];
const tabs = (current) =>
  /* HTML */ `<div class="tabs" role="tablist">
    ${TABS.map(
      (t) =>
        `<button role="tab" class="tab ${t.id === current ? 'on' : ''}" aria-selected="${t.id === current}" data-tab="${t.id}">${t.label}</button>`,
    ).join('')}
  </div>`;

const head = (s, r) =>
  /* HTML */ `<header class="page-head watch-head">
    ${back(s)}
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
            <b
              >${
                r.videoId
                  ? 'This recording needs another check'
                  : 'This recording has not been processed'
              }</b
            >
            <p>
              ${
                r.videoId
                  ? 'It is in VideoDB; playback still has to be confirmed.'
                  : 'It is kept on this Mac. Recover it to finish processing.'
              }
            </p>
          </div>
          ${button(
            'retryRecording',
            r.videoId ? 'Check again' : 'Recover recording',
            `data-id="${esc(r.id)}"`,
          )}
        </div>`
      : ''
  }`;

// The person's marks, as their own tab. A function, so TABS above can name it.
function marks(r) {
  return /* HTML */ `<section class="reading" aria-label="Your marks">
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
      '<p class="reading-empty">No marks. Press ⇧⌘M while recording to save a moment.</p>'
    }
  </section>`;
}

// The video with its own playbar: play, the time, speed and full screen.
const player = (r) =>
  r.streamUrl
    ? /* HTML */ `<div class="player">
          <video
            preload="metadata"
            data-player
            aria-label="Recorded video"
          ></video>
          <div class="player-bar">
            <button data-player-toggle aria-label="Play">
              ${icon('play')}${icon('pause')}
            </button>
            <span data-player-time>0:00 / ${clock(r.duration)}</span>
            <span class="grow"></span>
            <button data-player-speed aria-label="Playback speed">1×</button>
            <button data-player-full aria-label="Full screen">
              ${icon('expand')}
            </button>
          </div>
        </div>
        <p class="caption player-error" data-player-error role="status"></p>`
    : '<div class="player player-empty">Playback is not ready yet.</div>';

// What is playing. Versions made from this recording will join the original here.
const playing = (r) =>
  /* HTML */ `<div class="playing">
    <span class="label">Playing</span>
    <span class="version on"
      ><b>Original</b><span class="caption">${clock(r.duration)}</span></span
    >
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
    ${head(s, r)}${notices(r)}
    <div class="watch">
      <div class="watch-stage">
        <div class="watch-video">${player(r)}${timeline(r)}${playing(r)}</div>
      </div>
      <aside class="watch-read" aria-label="Summary, transcript and marks">
        ${tabs(current.id)}
        <div class="watch-text">
          ${current.view(r, s.account.status === 'signed-in')}
        </div>
      </aside>
    </div>
  </section>`;
}
