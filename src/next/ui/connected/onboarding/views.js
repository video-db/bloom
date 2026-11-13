// The three onboarding steps as markup. Pure: each view is a function of the app state and
// this window's flow state, so every state can be drawn and tested on its own.
import { esc, logo } from '../dom.js';

const STEPS = ['Connect', 'Permissions', 'Ready'];

const svg = (body) =>
  `<svg class="setup-icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const icons = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5" />'),
  warning: svg('<path d="M12 4.5l8.5 15h-17zM12 10.5v4M12 17.3v.1" />'),
  screen: svg(
    '<rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" />',
  ),
  mic: svg(
    '<rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />',
  ),
  up: svg('<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" />'),
};

function shell(step, body) {
  return /* HTML */ `<main class="setup">
    <div class="setup-titlebar drag" aria-hidden="true"></div>
    <header class="setup-header drag">
      <div class="brandname">${logo} Bloom</div>
      <div
        class="setup-progress"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin="1"
        aria-valuemax="${STEPS.length}"
        aria-valuenow="${step + 1}"
        aria-valuetext="Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}"
      >
        ${STEPS.map(
          (_, index) =>
            `<span class="${index === step ? 'current' : index < step ? 'complete' : ''}"></span>`,
        ).join('')}
      </div>
    </header>
    ${body}
    <div class="setup-credit">
      <span>Powered by</span>
      <img
        src="../assets/videodb-wordmark.png"
        alt="VideoDB"
        width="77"
        height="12"
      />
    </div>
  </main>`;
}

// ---- 1 · Connect -----------------------------------------------------------------------

// What the Connect step is showing, from the account state and what this window did.
export function connectStatus(s, flow) {
  const { status } = s.account;
  if (status === 'checking') return 'checking';
  if (status === 'signed-in') return 'connected';
  // Typing again withdraws the complaint about the previous attempt.
  if (!flow.cleared) {
    // A rejection this window did not cause means the saved key stopped working.
    if (status === 'invalid') return flow.attempted ? 'invalid' : 'expired';
    if (status === 'offline') return 'offline';
  }
  return flow.key ? 'typed' : 'empty';
}

const connectButton = {
  empty: `<button class="btn pri setup-action" disabled>Connect to VideoDB</button>`,
  typed: `<button class="btn pri setup-action">Connect to VideoDB</button>`,
  checking: `<button class="btn pri setup-action busy" disabled><i class="setup-spinner"></i>Connecting…</button>`,
  connected: `<button class="btn pri setup-action done" disabled>${icons.check}Connected</button>`,
  invalid: `<button class="btn pri setup-action">Connect to VideoDB</button>`,
  offline: `<button class="btn pri setup-action">Try again</button>`,
  expired: `<button class="btn pri setup-action" disabled>Connect to VideoDB</button>`,
};

const connectMessage = {
  invalid: `<p class="setup-message bad" role="alert">${icons.warning}<span>That key wasn’t accepted. Check it and try again.</span></p>`,
  offline: `<p class="setup-message warn" role="alert">${icons.warning}<span>Can’t reach VideoDB. Check your connection.</span></p>`,
};

export function connect(s, flow) {
  const status = connectStatus(s, flow);
  const locked = status === 'checking' || status === 'connected';
  // While a saved key is being checked there is nothing in the field to show.
  const restoring = locked && !flow.key;
  return shell(
    0,
    /* HTML */ `<section class="setup-content" aria-labelledby="setup-title">
      <h1 id="setup-title">Your work, ready to share.</h1>
      <p class="setup-lede">Connect VideoDB to save and share recordings.</p>
      ${
        status === 'expired'
          ? `<p class="setup-notice" role="status">${icons.warning}<span>Your saved key stopped working. Paste a new one to keep recording.</span></p>`
          : ''
      }
      <form data-form="connect" class="setup-form" novalidate>
        <label for="setup-key">VideoDB API key</label>
        <div class="setup-field">
          <input
            id="setup-key"
            name="key"
            type="password"
            class="field ${status === 'invalid' ? 'invalid' : ''}"
            placeholder="${restoring ? 'Using your saved key' : 'Paste your API key'}"
            autocomplete="off"
            spellcheck="false"
            maxlength="4096"
            data-focus="key"
            ${status === 'invalid' ? 'aria-invalid="true"' : ''}
            ${locked ? 'disabled' : ''}
          />
          ${
            flow.key || locked
              ? ''
              : `<button type="button" class="setup-paste" data-act="paste">Paste</button>`
          }
        </div>
        ${connectMessage[status] || ''}${connectButton[status]}
      </form>
      <p class="setup-note">Encrypted on this Mac.</p>
      <button
        type="button"
        class="btn setup-create"
        data-ui="get-api-key"
        aria-label="Create a VideoDB account (opens browser)"
        ${locked ? 'disabled' : ''}
      >
        Create a VideoDB account
      </button>
    </section>`,
  );
}

// ---- 2 · Permissions -------------------------------------------------------------------

export function screenStatus(s, flow) {
  if (s.permissions.screen) return 'on';
  // Back from System Settings and still off: macOS may be waiting for Bloom to reopen.
  if (flow.screenReturned) return 'returned';
  return flow.screenAsked ? 'waiting' : 'ask';
}
export function micStatus(s, flow) {
  if (s.permissions.mic) return 'on';
  if (flow.micAsking) return 'asking';
  return flow.micDenied ? 'denied' : 'ask';
}
export const canContinue = (s) =>
  s.permissions.screen && s.recorder.status === 'ready';

const screenRow = {
  ask: [
    'To record your screen and, if you choose, its sound.',
    `<button class="btn setup-small" data-act="screen">Open Settings</button>`,
  ],
  waiting: [
    'Turn on Bloom under Screen &amp; System Audio Recording.',
    `<span class="setup-waiting"><i class="setup-spinner dark"></i>Waiting…</span>`,
  ],
  returned: [
    '<span class="warn">Turned it on? macOS needs Bloom to reopen to finish.</span>',
    `<span class="setup-stack"><button class="btn pri setup-small" data-ui="relaunch">Reopen Bloom</button><button class="setup-link" data-act="screen">Open Settings</button></span>`,
  ],
  on: [
    'On. This is what Bloom can see.',
    `<span class="setup-preview" data-preview="screen" aria-label="Screen recording is on">${icons.check}</span>`,
  ],
};
const micRow = {
  ask: [
    'For your voice.',
    `<button class="btn setup-small" data-act="mic">Request access</button>`,
  ],
  asking: [
    'Answer the macOS question.',
    `<span class="setup-waiting"><i class="setup-spinner dark"></i>Waiting…</span>`,
  ],
  denied: [
    'Off. You can record without it and turn it on later.',
    `<button class="btn setup-small" data-ui="open-settings" data-key="mic">Open Settings</button>`,
  ],
  on: [
    'On. Say something to see it move.',
    `<span class="setup-preview" data-preview="mic" aria-label="Microphone is on">${icons.check}</span>`,
  ],
};

const row = ({ icon, on, title, optional, hint, control }) =>
  /* HTML */ `<div class="setup-row ${on ? 'on' : ''}">
    <span class="setup-row-icon">${on ? icons.check : icon}</span>
    <div>
      <b>${title}${optional ? '<span class="setup-tag">Optional</span>' : ''}</b
      ><small>${hint}</small>
    </div>
    ${control}
  </div>`;

export function permissions(s, flow) {
  const screen = screenStatus(s, flow);
  const mic = micStatus(s, flow);
  const failed = s.recorder.status === 'failed';
  return shell(
    1,
    /* HTML */ `<section class="setup-content" aria-labelledby="setup-title">
        <h1 id="setup-title">You’re in control.</h1>
        <p class="setup-lede">Nothing records until you press Start.</p>
        <div class="setup-rows">
          ${row({
            icon: icons.screen,
            on: screen === 'on',
            title: 'Screen and system audio',
            hint: screenRow[screen][0],
            control: screenRow[screen][1],
          })}
          ${row({
            icon: icons.mic,
            on: mic === 'on',
            title: 'Microphone',
            optional: true,
            hint: micRow[mic][0],
            control: micRow[mic][1],
          })}
        </div>
        ${
          failed
            ? `<p class="setup-message warn" role="alert">${icons.warning}<span>${esc(s.recorder.message || 'Bloom’s recorder didn’t start.')} <button class="setup-link" data-command="prepareRecorder">Try again</button></span></p>`
            : `<p class="setup-disclosure">While you record, your screen and audio go to your VideoDB account. The video is saved on this Mac first, then uploaded.</p>`
        }
      </section>
      <footer class="setup-foot">
        <button class="btn quiet" data-act="change-key">Change key</button>
        <button
          class="btn pri"
          data-act="continue"
          ${canContinue(s) ? '' : 'disabled'}
        >
          Continue
        </button>
      </footer>`,
  );
}

// ---- 3 · Ready -------------------------------------------------------------------------

export function ready(s) {
  return shell(
    2,
    /* HTML */ `<section class="setup-content" aria-labelledby="setup-title">
        <h1 id="setup-title">A click away.</h1>
        <p class="setup-lede">Bloom lives in your menu bar.</p>
        <div class="setup-menubar" aria-hidden="true">
          <span>Wi-Fi</span><span>100%</span
          ><span class="setup-menubar-mark">${logo}</span><span>14:02</span>
        </div>
        <p class="setup-pointer" aria-hidden="true">
          ${icons.up} Click the flower to record
        </p>
        <div class="setup-rows">
          <div class="setup-line">
            <span>Start or stop from anywhere</span><kbd>⇧⌘R</kbd>
          </div>
          ${
            s.loginSupported
              ? /* HTML */ `<label class="setup-line"
                  ><span>Open Bloom at login</span
                  ><input
                    type="checkbox"
                    class="setup-switch"
                    data-pref="openAtLogin"
                    ${s.prefs.openAtLogin ? 'checked' : ''}
                /></label>`
              : ''
          }
        </div>
        ${
          s.prefError
            ? `<p class="setup-message warn" role="alert">${icons.warning}<span>${esc(s.prefError)}</span></p>`
            : ''
        }
      </section>
      <footer class="setup-foot">
        <button class="btn quiet" data-act="back">Back</button>
        <button class="btn pri" data-ui="onboarding-done">Open Bloom</button>
      </footer>`,
  );
}
