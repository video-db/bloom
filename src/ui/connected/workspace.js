// The main window: a compact recording browser beside one workspace for the selected
// recording. The transcript is the wide column; the player and marks sit beside it.
// Editing, versions and the request bar join this layout when they are built.
import { esc, clock, logo, button, problems } from './dom.js';
import { icon } from './icons.js';
import { settings } from './settings.js';

const day = (r) =>
  r.createdAt
    ? new Date(r.createdAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : '';
// A ready recording needs no label. Only say something when there is something to know.
const status = (r) =>
  r.status === 'error'
    ? 'Needs attention'
    : r.status === 'ready'
      ? ''
      : 'Processing';
const meta = (r) =>
  [day(r), clock(r.duration), status(r)].filter(Boolean).join(' · ');

// ---- title bar: what Bloom is doing right now, and the way back to the recorder ----
const capture = {
  starting: () => '<span class="badge">Starting…</span>',
  recording: (s) =>
    `<span class="badge rec"><b class="mono" data-clock>${clock(s.elapsed)}</b> · <button data-command="stop">Stop</button></span>`,
  paused: () =>
    '<span class="badge warn">Paused · <button data-command="resume">Resume</button></span>',
  stopping: () => '<span class="badge">Stopping…</span>',
  stopped: () =>
    '<span class="badge warn">Capture needs attention · <button data-ui="show-panel">Review</button></span>',
  saving: () => '<span class="badge">Saving…</span>',
  'processing-error': () =>
    '<span class="badge warn">Saving needs attention · <button data-ui="show-panel">Review</button></span>',
};

// No brand beside the window buttons: the one branded thing here is the action.
const titleBar = (s) =>
  /* HTML */ `<header class="bar drag">
    <span class="right nodrag">${capture[s.phase]?.(s) || ''}</span>
    <button
      class="btn pri capture-start bar-record nodrag"
      data-ui="show-panel"
    >
      ${logo}<span>New recording</span>
    </button>
  </header>`;

// ---- recording browser ----
const ORDERS = {
  newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  oldest: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
  name: (a, b) => a.title.localeCompare(b.title),
  longest: (a, b) => b.duration - a.duration,
};
const FILTERS = {
  all: () => true,
  processing: (r) => r.status !== 'ready' && r.status !== 'error',
  attention: (r) => r.status === 'error',
};
const option = (value, label, selected) =>
  `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`;

function browser(s, activeId, list) {
  const words = list.query.toLowerCase().trim();
  const records = s.recordings
    .filter(
      (r) =>
        (FILTERS[list.filter] || FILTERS.all)(r) &&
        `${r.title} ${r.transcript}`.toLowerCase().includes(words),
    )
    .sort(ORDERS[list.order] || ORDERS.newest);
  const rows = records
    .map(
      (r) =>
        /* HTML */ `<button
          class="record-row ${r.id === activeId ? 'selected' : ''}"
          data-record="${esc(r.id)}"
          aria-current="${r.id === activeId}"
          title="${esc(r.title)}"
        >
          <span class="shot"></span
          ><span class="record-copy"
            ><b>${esc(r.title)}</b><small>${esc(meta(r))}</small></span
          >
        </button>`,
    )
    .join('');
  const empty = s.recordings.length
    ? '<div class="browser-empty"><b>No matches</b><p>Try another search or filter.</p></div>'
    : '<div class="browser-empty"><b>No recordings yet</b><p>Start one from the menu bar.</p></div>';
  return /* HTML */ `<aside class="browser" aria-label="Recording browser">
    <div class="browser-heading">
      <h1>Recordings</h1>
      <span class="soft">${s.recordings.length}</span>
    </div>
    <label class="search"
      >${icon('search')}<input
        data-query
        data-focus="query"
        aria-label="Search recordings"
        placeholder="Search titles and transcripts"
        value="${esc(list.query)}"
    /></label>
    <div class="browser-filters">
      <select data-list="filter" aria-label="Filter recordings">
        ${option('all', 'All recordings', list.filter)}
        ${option('processing', 'Processing', list.filter)}
        ${option('attention', 'Needs attention', list.filter)}</select
      ><select data-list="order" aria-label="Sort recordings">
        ${option('newest', 'Newest', list.order)}
        ${option('oldest', 'Oldest', list.order)}
        ${option('name', 'A–Z', list.order)}
        ${option('longest', 'Longest', list.order)}
      </select>
    </div>
    <div class="recording-list">${rows || empty}</div>
    <footer class="browser-footer">
      <span class="browser-credit"
        ><img
          class="videodb-wordmark"
          src="../assets/videodb-wordmark.png"
          alt="VideoDB"
          width="62"
          height="10"
        />${s.online ? '' : '<span>Offline</span>'}</span
      ><button
        class="icon-button"
        data-view="settings"
        aria-label="Settings"
        title="Settings (⌘,)"
      >
        ${icon('settings')}
      </button>
    </footer>
  </aside>`;
}

// ---- the selected recording ----
const toolbar = (r) =>
  /* HTML */ `<header class="workspace-toolbar">
    <div class="record-title">
      <h1 title="${esc(r.title)}">${esc(r.title)}</h1>
      <span>${esc(meta(r))}</span>
    </div>
    <button
      class="btn"
      data-ui="copy-link"
      data-id="${esc(r.id)}"
      ${!r.playerUrl || r.status !== 'ready' ? 'disabled' : ''}
    >
      Copy link
    </button>
    <details class="record-menu">
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
    </details>
  </header>`;

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

// What the transcript column says when there is no text to show.
function transcriptState(r, signedIn) {
  const prepare = button(
    'requestTranscript',
    'Prepare transcript',
    `data-id="${esc(r.id)}"`,
    !r.videoId || !signedIn,
  );
  const again = button(
    'openRecording',
    'Try again',
    `data-id="${esc(r.id)}"`,
    !r.videoId || !signedIn,
  );
  const states = {
    processing: ['Preparing the transcript…', ''],
    error: ['The transcript could not be loaded.', again],
    empty: [
      'No transcript text is available yet. This does not confirm there was no speech.',
      prepare,
    ],
  };
  const [message, action] = states[r.transcriptStatus] || [
    'No transcript yet.',
    prepare,
  ];
  return /* HTML */ `<div class="transcript-empty">
    <p>${message}</p>
    ${action}
    ${
      action === prepare
        ? '<p class="caption">Preparing a transcript may use VideoDB credits.</p>'
        : ''
    }
  </div>`;
}

const transcript = (r, signedIn) =>
  /* HTML */ `<section class="transcript-pane" aria-label="Transcript">
    <div class="section-heading"><h2>Transcript</h2></div>
    ${
      r.transcript
        ? `<p id="transcript" tabindex="0">${esc(r.transcript)}</p>`
        : transcriptState(r, signedIn)
    }
  </section>`;

const side = (r) =>
  /* HTML */ `<aside class="preview-pane" aria-label="Playback and marks">
    <div class="player-card">
      ${
        r.streamUrl
          ? '<video controls preload="metadata" data-player aria-label="Recorded video"></video><p class="caption" data-player-error role="status"></p>'
          : '<div class="player-empty">Playback is not ready yet.</div>'
      }
    </div>
    <div class="section-heading">
      <h2>Marked moments</h2>
      <span class="soft"
        >${r.marks.length} mark${r.marks.length === 1 ? '' : 's'}</span
      >
    </div>
    <div class="mark-list">
      ${
        r.marks
          .map(
            (m) =>
              /* HTML */ `<button class="moment-result" data-seek="${m.at}">
                <span class="ts">${clock(m.at)}</span
                ><span>${esc(m.text || 'Marked moment')}</span>
              </button>`,
          )
          .join('') ||
        '<p class="caption">No marks. Press ⇧⌘M while recording to save a moment.</p>'
      }
    </div>
  </aside>`;

function recording(s, id) {
  const r = s.recordings.find((item) => item.id === id);
  if (!r)
    return /* HTML */ `<div class="workspace-empty">
      <h2>Your workspace is ready</h2>
      <p>Select a recording, or start one from the menu bar.</p>
      <button class="btn pri" data-ui="show-panel">New recording</button>
    </div>`;
  return /* HTML */ `<section class="workspace">
    ${toolbar(r)}${notices(r)}
    <div class="workspace-columns">
      ${transcript(r, s.account.status === 'signed-in')}${side(r)}
    </div>
  </section>`;
}

// list: { query, filter, order } — how this window is browsing its recordings.
export function workspace(s, view, activeId, list) {
  if (s.account.status !== 'signed-in')
    return '<main class="workspace-empty"><h1>Sign in to continue</h1><button class="btn" data-ui="open-onboarding">Open setup</button></main>';
  return /* HTML */ `<div class="app">
    ${titleBar(s)}
    <div class="body">
      ${browser(s, activeId, list)}
      <main class="view">
        ${problems(s)}${view === 'settings' ? settings(s) : recording(s, activeId)}
      </main>
    </div>
  </div>`;
}
