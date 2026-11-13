import { esc, clock, logo, button, problems } from './dom.js';

export const phases = {
  idle: 'Ready',
  starting: 'Starting',
  recording: 'Recording',
  paused: 'Paused',
  stopping: 'Stopping',
  stopped: 'Capture status needs attention',
  saving: 'Saving',
  finished: 'Ready to play',
  'processing-error': 'Saving needs attention',
};

export function permissions(s) {
  return /* HTML */ `<div class="connected-permissions">
    ${[
      ['screen', 'Screen and system audio'],
      ['mic', 'Microphone'],
    ]
      .map(
        ([key, label]) =>
          /* HTML */ `<div class="perm">
            <div>
              <b>${label}</b
              ><small
                >${key === 'screen'
                  ? 'One macOS permission; system audio stays optional.'
                  : 'Optional, for your narration.'}</small
              >
            </div>
            ${s.permissions[key]
              ? '<span class="chip ok">Allowed</span>'
              : button(
                  'setPermission',
                  'Allow',
                  `data-key="${key}" data-value="true"`,
                  s.account.status !== 'signed-in',
                )}
          </div>`,
      )
      .join('')}${button('checkPermission', 'Check again')}<button
      class="btn quiet"
      data-ui="open-settings"
    >
      System Settings
    </button>
  </div>`;
}

function sources(s) {
  const option = (items, selected) =>
    items
      .map(
        (c) =>
          /* HTML */ `<option
            value="${esc(c.id)}"
            ${c.id === selected ? 'selected' : ''}
          >
            ${esc(c.name)}
          </option>`,
      )
      .join('');
  return /* HTML */ `<label
      >Screen<select
        class="field"
        data-source="screen"
        aria-label="Recording display"
      >
        ${option(s.channels.displays, s.sources.screen)}
      </select></label
    ><label
      >Microphone<select
        class="field"
        data-source="microphone"
        aria-label="Recording microphone"
      >
        ${option(s.channels.mics, s.sources.microphone)}
      </select></label
    >
    <div class="connected-toggles">
      <label
        ><input
          type="checkbox"
          data-source="mic"
          ${s.sources.mic ? 'checked' : ''}
        />
        Microphone</label
      ><label
        ><input
          type="checkbox"
          data-source="systemAudio"
          ${s.sources.systemAudio ? 'checked' : ''}
        />
        System audio</label
      >
    </div>`;
}

export function capture(s) {
  const idle = ['idle', 'finished'].includes(s.phase);
  let content = '';
  if (idle)
    content = `${s.prefs.askPurpose ? /* HTML */ `<label>Recording title (optional)<input class="field" data-purpose data-focus="purpose" maxlength="180" value="${esc(s.purpose)}" aria-label="Recording title" /></label>` : ''}${sources(s)}${!s.permissions.screen || (s.sources.mic && !s.permissions.mic) ? permissions(s) : ''}<button class="btn pri capture-start" data-command="start" ${s.account.status !== 'signed-in' || !s.permissions.screen || (s.sources.mic && !s.permissions.mic) ? 'disabled' : ''}>${logo}<span>Start recording</span><kbd>⇧⌘R</kbd></button>`;
  if (['recording', 'paused'].includes(s.phase))
    content = /* HTML */ `<p>
        ${s.phase === 'paused'
          ? 'Paused. No selected sources are being captured.'
          : 'Capturing the selected screen' +
            (s.sources.mic ? ', microphone' : '') +
            (s.sources.systemAudio ? ', and system audio.' : '.')}
      </p>
      <div class="row2">
        ${button(
          s.phase === 'paused' ? 'resume' : 'pause',
          s.phase === 'paused' ? 'Resume' : 'Pause',
        )}${button('stop', 'Stop recording')}
      </div>
      ${s.phase === 'recording'
        ? /* HTML */ `<form data-form="mark">
            <label
              >Mark a moment<input
                class="field"
                name="note"
                data-focus="note"
                maxlength="500"
                placeholder="Add a note, then press Enter"
                aria-label="Mark a moment"
            /></label>
          </form>`
        : ''}
      <div>
        ${s.marks
          .map(
            (m) =>
              /* HTML */ `<p>
                <span class="mono">${clock(m.at)}</span> ${esc(m.text)}
              </p>`,
          )
          .join('')}
      </div>`;
  if (s.phase === 'starting')
    content =
      '<p>Not recording yet. Waiting for the capture sources to start.</p>';
  if (s.phase === 'finished')
    content = /* HTML */ `<p>
        Your recording is ready to play. The transcript can be prepared
        separately.
      </p>
      ${button('newRecording', 'New recording')}`;
  if (s.phase === 'stopping')
    content =
      '<p>Waiting for the recorder to confirm capture has stopped. Keep Bloom open.</p>';
  if (s.phase === 'stopped')
    content = /* HTML */ `<p>
        Capture may still be running. Confirm Stop before starting another
        recording.
      </p>
      ${button('stop', 'Try Stop again')}`;
  if (s.phase === 'saving')
    content = /* HTML */ `<p>
        Not recording.
        ${s.upload?.stage === 'finalizing'
          ? 'Finalizing the local MP4.'
          : 'Uploading the local MP4 and preparing playback.'}
      </p>
      <p class="soft">
        Keep Bloom open while saving finishes. Playback and transcript become
        available separately.
      </p>`;
  if (s.phase === 'processing-error') {
    const record = s.recordings.find((r) => r.sessionId === s.sessionId);
    content = /* HTML */ `<p>
        The recording needs attention. Retry checks the retained job or existing
        cloud result.
      </p>
      ${record
        ? button(
            'retryRecording',
            'Check and retry',
            `data-id="${esc(record.id)}"`,
          )
        : ''}
      ${button('newRecording', 'Leave for recovery and record again')}`;
  }
  return /* HTML */ `<div class="connected-capture">
    <div class="connected-status">
      <b>${phases[s.phase] || 'Bloom'}</b
      ><span class="mono" data-clock>${clock(s.elapsed)}</span>
    </div>
    ${content}
  </div>`;
}

export function panel(s) {
  const needsSetup = s.account.status !== 'signed-in' && ['idle', 'finished'].includes(s.phase);
  const setup = /* HTML */ `<div class="connected-capture">
    <p class="soft" role="status">${s.account.status === 'checking' ? 'Checking your connection…' : 'Finish setup to start recording.'}</p>
    <button class="btn capture-start" disabled>Start recording</button>
    <button class="btn" data-ui="open-onboarding">Finish setup</button>
  </div>`;
  return /* HTML */ `<section class="panel">
    <header class="ph">
      <span class="brandname">${logo} Bloom</span
      ><button class="link" data-ui="open-main" data-view="library" ${s.account.status !== 'signed-in' ? 'disabled' : ''}>
        Recordings ↗
      </button>
    </header>
    <div class="pb">
      ${problems(s)}${s.account.status === 'signed-in'
        ? button('checkConnection', 'Refresh connection and sources')
        : ''}${s.hint === 'first-recording' && s.phase === 'idle' && !needsSetup
        ? '<p class="panel-hint" role="status">Start your first recording here. ⇧⌘R works from anywhere.</p>'
        : ''}${needsSetup ? setup : capture(s)}${s.result
        ? /* HTML */ `<div class="card">
            <b>${esc(s.result.title)}</b>
            <div class="row2">
              <button
                class="btn"
                data-ui="open-main"
                data-id="${esc(s.result.id)}"
                data-view="detail"
              >
                Open recording</button
              ><button
                class="btn"
                data-ui="copy-link"
                data-id="${esc(s.result.id)}"
              >
                Copy link
              </button>
            </div>
          </div>`
        : ''}${s.pending.length
        ? /* HTML */ `<h3>Pending recordings</h3>
            ${s.pending
              .map(
                (p) =>
                  /* HTML */ `<div class="card">
                    <b>${esc(p.title)}</b>
                    <p>${esc(p.stage)}</p>
                    ${button(
                      'resumeUpload',
                      'Retry upload',
                      `data-id="${esc(p.id)}"`,
                      p.status === 'uploading',
                    )}
                  </div>`,
              )
              .join('')}`
        : ''}
    </div>
    <footer class="pf">
      <button class="link" data-ui="open-preferences" ${s.account.status !== 'signed-in' ? 'disabled' : ''}>Settings</button
      ><button class="link" data-ui="quit">Quit</button>
    </footer>
  </section>`;
}
