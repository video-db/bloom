// One recording in focus, in one of two modes. Watch: the video is the main thing, with its
// playbar and a timeline of chapters and marks under it; the summary, transcript and marks
// are a column beside it, and every time in them jumps the video. Make: the same video and
// timeline, with lanes showing what would change and a panel of choices beside them.
import { esc, clock, button } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { meta, status } from './format.js';
import { stage, progressBar } from '../shared/stage.js';
import { transcript } from './transcript.js';
import { summary } from './summary.js';
import { timeline } from './timeline.js';
import { playingRow, playingVersion, timed } from './versions.js';
import { lanes, makePanel, silences, chosen, titlePreview } from './make.js';

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

// Watch or Make. Only Bloom's own recordings can be made into something.
const modes = (page) =>
  /* HTML */ `<span class="seg" role="group" aria-label="Watch or make">
    ${['watch', 'make']
      .map(
        (m) =>
          `<button class="${page.mode === m ? 'on' : ''}" aria-pressed="${page.mode === m}" data-mode="${m}">${m === 'watch' ? 'Watch' : 'Make'}</button>`,
      )
      .join('')}
  </span>`;

// Copy link copies what is playing: the original, or the version being watched.
const head = (s, r, page) => {
  const version = playingVersion(r, page);
  const ready = version
    ? !!version.playerUrl
    : r.playerUrl && r.status === 'ready';
  return /* HTML */ `<header class="page-head watch-head">
    ${back(s)}
    <h1 title="${esc(r.title)}">${esc(r.title)}</h1>
    <span class="caption"
      >${esc([meta(r), status(r)].filter(Boolean).join(' · '))}</span
    >
    <span class="grow"></span>
    ${r.readOnly ? '' : modes(page)}
    <button
      class="btn"
      data-ui="copy-link"
      data-id="${esc(r.id)}"
      ${version ? `data-version="${esc(version.id)}"` : ''}
      ${ready ? '' : 'disabled'}
    >
      Copy link
    </button>
    ${r.readOnly ? '' : menu(r)}
  </header>`;
};

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
  }${progressBar(stage(r).progress)}`;

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
// playing: { streamUrl, duration } of the original or of a version. over: markup drawn
// on top of the picture (Make's title preview).
const player = (playing, over = '') =>
  playing.streamUrl
    ? /* HTML */ `<div class="player">
          <video
            preload="metadata"
            data-player
            aria-label="Recorded video"
          ></video>
          ${over}
          <div class="player-bar">
            <button data-player-toggle aria-label="Play">
              ${icon('play')}${icon('pause')}
            </button>
            <span data-player-time>0:00 / ${clock(playing.duration)}</span>
            <span class="grow"></span>
            <button data-player-speed aria-label="Playback speed">1×</button>
            <button data-player-full aria-label="Full screen">
              ${icon('expand')}
            </button>
          </div>
        </div>
        <p class="caption player-error" data-player-error role="status"></p>`
    : '<div class="player player-empty">Playback is not ready yet.</div>';

const back = (s) =>
  /* HTML */ `<button class="crumb" data-view="recordings">
    ${icon('back')}<span
      >${s.browsing ? esc(s.browsing.name) : 'Recordings'}</span
    >
  </button>`;

// tab: which of TABS is showing. page: { mode, playing, choices, titleText } for this
// recording, kept by the window.
export function recording(s, id, tab, page) {
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
  const signedIn = s.account.status === 'signed-in';
  if (page.mode === 'make' && !r.readOnly)
    return /* HTML */ `<section class="page recording">
      ${head(s, r, page)}${notices(r)}
      <div class="watch make">
        <div class="watch-stage">
          <div class="watch-video">
            ${player(r, titlePreview(r, page))}${timeline(r, {
              cuts: chosen(r, page).silences ? silences(r).list : [],
            })}${lanes(r, page)}
          </div>
        </div>
        ${makePanel(r, page, signedIn)}
      </div>
    </section>`;
  const current = TABS.find((t) => t.id === tab) || TABS[0];
  const version = playingVersion(r, page);
  return /* HTML */ `<section class="page recording">
    ${head(s, r, page)}${notices(r)}
    <div class="watch">
      <div class="watch-stage">
        <div class="watch-video">
          ${player(version || r)}${timeline(timed(r, version))}${playingRow(r, page)}
        </div>
      </div>
      <aside class="watch-read" aria-label="Summary, transcript and marks">
        ${tabs(current.id)}
        <div class="watch-text" data-scroll="read">
          ${current.view(r, signedIn)}
        </div>
      </aside>
    </div>
  </section>`;
}
