// Settings in the main window: grouped cards of rows, each a name, a one-line hint and its
// control. Only rows the running app can honour are shown.
import { esc } from '../shared/dom.js';

const row = (name, hint, control) =>
  /* HTML */ `<div class="srow">
    <div><b>${name}</b>${hint ? `<small>${hint}</small>` : ''}</div>
    ${control}
  </div>`;

const toggle = (s, key, label) =>
  /* HTML */ `<button
    class="tgl ${s.prefs[key] ? 'on' : ''}"
    data-pref="${key}"
    data-value="${!s.prefs[key]}"
    aria-pressed="${!!s.prefs[key]}"
    aria-label="${label}"
  ></button>`;

const choice = (s, key, label, options) =>
  /* HTML */ `<span class="seg" role="group" aria-label="${label}"
    >${options
      .map(
        ([value, text]) =>
          /* HTML */ `<button
            class="${s.prefs[key] === value ? 'on' : ''}"
            aria-pressed="${s.prefs[key] === value}"
            data-pref="${key}"
            data-value="${value}"
          >
            ${text}
          </button>`,
      )
      .join('')}</span
  >`;

const permission = (allowed) =>
  `<span class="chip ${allowed ? 'ok' : 'warn'}">${allowed ? 'Allowed' : 'Not allowed'}</span>`;

const recording = (s) =>
  /* HTML */ `<h2>Recording</h2>
    <div class="card">
      ${row(
        'Microphone on by default',
        'Your narration. You can still turn it off for one recording in the tray panel.',
        toggle(s, 'defaultMic', 'Microphone on by default'),
      )}
      ${row(
        'Include system audio by default',
        'Meetings and app sound. Covered by the same macOS permission as the screen.',
        toggle(s, 'defaultSystemAudio', 'Include system audio by default'),
      )}
      ${row(
        'Shortcuts',
        'Start or stop <kbd>⇧⌘R</kbd> · Mark a moment <kbd>⇧⌘M</kbd>',
        '<span class="soft">Fixed for now</span>',
      )}
    </div>`;

const notifications = (s) =>
  /* HTML */ `<h2>Notifications</h2>
    <div class="card">
      ${row(
        'Link ready',
        'Only when Bloom is out of sight.',
        toggle(s, 'notifyLinkReady', 'Link ready notifications'),
      )}
      ${row(
        'Remind me about a long recording',
        'One reminder, so a forgotten recording does not keep running.',
        choice(s, 'nudgeMinutes', 'Reminder interval', [
          [0, 'Off'],
          [30, '30 min'],
          [45, '45 min'],
          [60, '1 hour'],
        ]),
      )}
    </div>`;

const privacy = (s) =>
  /* HTML */ `<h2>Privacy and storage</h2>
    <div class="card">
      ${row(
        'Where recordings go',
        'Your screen and audio stream to VideoDB while you record. The video is saved on this Mac, uploaded when you stop, and the local copy is removed once VideoDB confirms it. Download a copy to keep one.',
        `<span class="soft">${esc(s.environment || 'VideoDB')}</span>`,
      )}
      ${row(
        'Screen and system audio',
        'macOS permission. Needed to record.',
        permission(s.permissions.screen),
      )}
      ${row('Microphone', 'macOS permission.', permission(s.permissions.mic))}
      ${row(
        'Change permissions',
        'Opens System Settings, Privacy &amp; Security.',
        /* HTML */ `<span class="set-actions"
          ><button class="btn sm quiet" data-command="checkPermission">
            Check again</button
          ><button class="btn sm" data-ui="open-settings">
            Open System Settings
          </button></span
        >`,
      )}
    </div>`;

function account(s) {
  // Signing out mid-recording or mid-upload would strand the recording.
  const busy = !['idle', 'finished'].includes(s.phase) || s.pending.length > 0;
  return /* HTML */ `<h2>Account</h2>
    <div class="card">
      ${row(
        'VideoDB account',
        busy
          ? 'Connected. Sign out is available once the current recording has finished saving.'
          : 'Connected. Your key is encrypted on this Mac.',
        `<button class="btn sm" data-command="signOut" ${busy ? 'disabled' : ''}>Sign out</button>`,
      )}
    </div>`;
}

const general = (s) =>
  /* HTML */ `<h2>General</h2>
    <div class="card">
      ${row(
        'Appearance',
        'Follows macOS unless you choose.',
        choice(s, 'appearance', 'Appearance', [
          ['system', 'System'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ]),
      )}
      ${row(
        'Open Bloom when I log in',
        s.loginSupported ? '' : 'Available in the installed app.',
        s.loginSupported
          ? toggle(s, 'openAtLogin', 'Open Bloom when I log in')
          : '<span class="soft">Not available</span>',
      )}
      ${s.version ? row('Version', '', `<span class="soft">Bloom ${esc(s.version)}</span>`) : ''}
    </div>`;

export function settings(s) {
  return /* HTML */ `<section class="set">
    <div class="settings-heading">
      <button
        class="icon-button"
        data-view="library"
        aria-label="Back to recordings"
        title="Back to recordings"
      >
        ←
      </button>
      <h1>Settings</h1>
    </div>
    <span class="soft set-note">Preferences are saved on this Mac.</span>
    ${recording(s)}${notifications(s)}${privacy(s)}${account(s)}${general(s)}
  </section>`;
}
