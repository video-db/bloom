import { esc, clock, logo, button, problems } from './dom.js';
import { phases } from './panel.js';
import { settings } from './settings.js';

function details(s, id) {
  const r = s.recordings.find((item) => item.id === id);
  if (!r)
    return /* HTML */ `<div class="workspace-empty">
      <h1>Your workspace is ready</h1>
      <p>Select a recording or start one from the menu bar.</p>
      <button class="btn pri" data-ui="show-panel">New recording</button
      >
    </div>`;
  const transcriptLabel = {
    'not-requested': 'A transcript has not been requested.',
    empty:
      'No transcript text is available yet. This does not confirm there was no speech.',
    error: 'The transcript could not be loaded.',
    processing: 'Preparing the transcript…',
  }[r.transcriptStatus];
  return /* HTML */ `<section class="workspace connected-detail">
    <header class="workspace-toolbar">
      <div class="record-title">
        <h1>${esc(r.title)}</h1>
        <span
          >${clock(r.duration)} ·
          ${r.status === 'ready' ? 'Ready to play' : esc(r.jobStage)}</span
        >
      </div>
      <div class="connected-actions">
        <button
          class="btn"
          data-ui="copy-link"
          data-id="${esc(r.id)}"
          ${!r.playerUrl || r.status !== 'ready' ? 'disabled' : ''}
        >
          Copy link</button
        ><button
          class="btn"
          data-ui="download"
          data-id="${esc(r.id)}"
          ${r.status !== 'ready' ? 'disabled' : ''}
        >
          Download</button
        ><button
          class="btn"
          data-dialog="rename"
          data-id="${esc(r.id)}"
          ${r.pendingOperation ? 'disabled' : ''}
        >
          Rename</button
        ><button
          class="btn"
          data-dialog="delete"
          data-id="${esc(r.id)}"
          ${!r.videoId || r.pendingOperation ? 'disabled' : ''}
        >
          Delete
        </button>
      </div>
    </header>
    ${r.pendingOperation
      ? /* HTML */ `<div class="note" role="status">
          Checking the ${esc(r.pendingOperation)} operation…
          ${button(
            'reconcileRecording',
            'Check result',
            `data-id="${esc(r.id)}"`,
          )}
        </div>`
      : ''}${r.status === 'error'
      ? /* HTML */ `<div class="note" role="alert">
          The recording needs attention.
          ${button(
            'retryRecording',
            'Check and retry',
            `data-id="${esc(r.id)}"`,
          )}
        </div>`
      : ''}
    <div class="workspace-columns">
      <article class="transcript-pane connected-transcript">
        <h2>Transcript</h2>
        ${r.transcript
          ? /* HTML */ `<div class="connected-prose">${esc(r.transcript)}</div>`
          : /* HTML */ `<p class="soft">
              ${esc(transcriptLabel || 'The transcript is not ready.')}
            </p>`}
        <div class="connected-actions">
          ${button(
            'openRecording',
            'Refresh playback and transcript',
            `data-id="${esc(r.id)}"`,
            !r.videoId || s.account.status !== 'signed-in',
          )}${r.transcriptStatus !== 'ready'
            ? button(
                'requestTranscript',
                'Prepare transcript',
                `data-id="${esc(r.id)}"`,
                !r.videoId ||
                  r.transcriptStatus === 'processing' ||
                  s.account.status !== 'signed-in',
              )
            : ''}${r.transcript
            ? /* HTML */ `<button
                class="btn"
                data-copy-transcript="${esc(r.id)}"
              >
                Copy transcript
              </button>`
            : ''}
        </div>
        <p class="soft">
          Preparing a transcript may use VideoDB credits. Opening a recording
          only reads an existing transcript.
        </p>
      </article>
      <aside class="connected-player-pane">
        ${r.streamUrl
          ? '<video controls preload="metadata" data-player aria-label="Recorded video"></video><p class="soft" data-player-error role="status"></p>'
          : '<div class="connected-video-empty">Playback is not ready. Use Refresh after processing completes.</div>'}
        <h2>Your marks</h2>
        ${r.marks
          .map(
            (m) =>
              /* HTML */ `<button class="moment-result" data-seek="${m.at}">
                <span class="mono">${clock(m.at)}</span
                ><span>${esc(m.text)}</span>
              </button>`,
          )
          .join('') || '<p class="soft">No marks in this recording.</p>'}
      </aside>
    </div>
  </section>`;
}

export function workspace(s, view, activeId, query = '') {
  if (s.account.status !== 'signed-in')
    return '<main class="workspace-empty"><h1>Sign in to continue</h1><button class="btn" data-ui="open-onboarding">Open setup</button></main>';
  const records = s.recordings.filter((r) =>
    `${r.title} ${r.transcript}`.toLowerCase().includes(query.toLowerCase()),
  );
  return /* HTML */ `<div class="app">
    <header class="bar drag">
      <span class="brandname">${logo} Bloom</span
      ><span class="right nodrag"
        >${phases[s.phase]}${['recording', 'paused'].includes(s.phase)
          ? ` · <b data-clock>${clock(s.elapsed)}</b> ${button('stop', 'Stop')}`
          : ''}</span
      ><button class="btn nodrag" data-ui="show-panel">
        Recording controls
      </button>
    </header>
    <div class="body">
      <aside class="browser">
        <div class="browser-heading">
          <h1>Recordings</h1>
          <span>${s.recordings.length}</span>
        </div>
        <label class="search"
          ><input
            data-query
            data-focus="query"
            aria-label="Search titles and cached transcripts"
            placeholder="Search titles or cached words"
            value="${esc(query)}"
        /></label>
        <div class="recording-list">
          ${records
            .map(
              (r) =>
                /* HTML */ `<button
                  class="record-row ${r.id === activeId ? 'selected' : ''}"
                  data-record="${esc(r.id)}"
                >
                  <span class="shot"></span
                  ><span class="record-copy"
                    ><b>${esc(r.title)}</b
                    ><small
                      >${clock(r.duration)} ·
                      ${r.status === 'ready' ? 'Ready' : esc(r.jobStage)}</small
                    ></span
                  >
                </button>`,
            )
            .join('') || '<p class="browser-empty">No recordings match.</p>'}
        </div>
        <footer class="browser-footer">
          <span
            >${s.account.status === 'signed-in'
              ? 'VideoDB'
              : 'Cached library'}${s.online ? '' : ' · offline'}</span
          ><button class="link" data-view="settings">Settings</button>${button(
            'refresh',
            'Refresh',
            '',
            s.account.status !== 'signed-in',
          )}
        </footer>
      </aside>
      <main class="view">
        ${problems(s)}${view === 'settings'
          ? settings(s)
          : details(s, activeId)}
      </main>
    </div>
  </div>`;
}
