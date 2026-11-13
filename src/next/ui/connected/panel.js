import { esc, clock, logo, button, problems } from './dom.js';
import { icon } from './icons.js';
import { sources } from './sources.js';
import {
  stateHeader,
  stateBody,
  resultCard,
  pending,
  attention,
} from './tray-states.js';

const phases = {
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
                >${
                  key === 'screen'
                    ? 'One macOS permission; system audio stays optional.'
                    : 'Optional, for your narration.'
                }</small
              >
            </div>
            ${
              s.permissions[key]
                ? '<span class="chip ok">Allowed</span>'
                : button(
                    'setPermission',
                    'Allow',
                    `data-key="${key}" data-value="true"`,
                    s.account.status !== 'signed-in',
                  )
            }
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

// Ready to record: what will be captured, then Start.
function ready(s) {
  const blocked =
    !s.permissions.screen || (s.sources.mic && !s.permissions.mic);
  return /* HTML */ `${sources(s)}${blocked ? permissions(s) : ''}
    <button
      class="btn pri capture-start"
      data-command="start"
      ${s.account.status !== 'signed-in' || blocked ? 'disabled' : ''}
    >
      ${logo}<span>Start recording</span><kbd>⇧⌘R</kbd>
    </button>`;
}

// The two latest recordings, one click from the tray.
function recent(s, needsSetup) {
  if (needsSetup || !['idle', 'finished'].includes(s.phase) || !s.recent.length)
    return '';
  return /* HTML */ `<span class="label">Recent</span> ${s.recent
      .slice(0, 2)
      .map(
        (r) =>
          /* HTML */ `<button
            class="rc"
            data-ui="open-main"
            data-view="detail"
            data-id="${esc(r.id)}"
          >
            <span class="shot"></span
            ><span class="rc-copy"
              ><b>${esc(r.title)}</b><small>${clock(r.duration)}</small></span
            >
          </button>`,
      )
      .join('')}`;
}

export function panel(s) {
  const needsSetup =
    s.account.status !== 'signed-in' && ['idle', 'finished'].includes(s.phase);
  const setup = /* HTML */ `<div class="connected-capture">
    <p class="soft" role="status">
      ${s.account.status === 'checking' ? 'Checking your connection…' : 'Finish setup to start recording.'}
    </p>
    <button class="btn capture-start" disabled>Start recording</button>
    <button class="btn" data-ui="open-onboarding">Finish setup</button>
  </div>`;
  const between = ['idle', 'finished'].includes(s.phase);
  return /* HTML */ `<section class="panel">
    <header class="ph ${attention(s) ? 'warn' : ''}">
      ${stateHeader(s) || `<span class="brandname">${logo} Bloom</span>`}<button
        class="panel-open"
        data-ui="open-main"
        data-view="library"
        aria-label="Open Bloom"
        title="Open Bloom"
        ${s.account.status !== 'signed-in' ? 'disabled' : ''}
      >
        ${icon('window')}
      </button>
    </header>
    <div class="pb">
      ${problems(s)}${
        s.hint === 'first-recording' && s.phase === 'idle' && !needsSetup
          ? '<p class="panel-hint" role="status">Start your first recording here. ⇧⌘R works from anywhere.</p>'
          : ''
      }${resultCard(s)}${
        needsSetup ? setup : between ? ready(s) : stateBody(s)
      }${recent(s, needsSetup)}${pending(s)}
    </div>
    <footer class="pf">
      <button class="link" data-ui="quit">Quit</button
      ><button
        class="panel-gear"
        data-ui="open-preferences"
        aria-label="Settings"
        title="Settings"
        ${s.account.status !== 'signed-in' ? 'disabled' : ''}
      >
        ${icon('settings')}
      </button>
    </footer>
  </section>`;
}
