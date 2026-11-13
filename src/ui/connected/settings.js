import { esc, accountForm, button } from './dom.js';

export function settings(s) {
  const toggle = (key, label) =>
    /* HTML */ `<label class="connected-setting"
      ><span>${label}</span
      ><input
        type="checkbox"
        data-pref="${key}"
        ${s.prefs[key] ? 'checked' : ''}
    /></label>`;
  return /* HTML */ `<section class="set">
    <h1>Settings</h1>
    <h2>Account</h2>
    <div class="card">
      ${accountForm(s)}${
        s.account.status === 'signed-in'
          ? button(
              'signOut',
              'Sign out',
              '',
              !['idle', 'finished'].includes(s.phase) || s.pending.length > 0,
            )
          : ''
      }
      <p class="soft">
        ${esc(s.environment || 'VideoDB development')} · Recordings stream
        during capture and upload after Stop. Complete local media is removed by
        the recorder after confirmed ingestion. Download a copy to keep it
        permanently.
      </p>
    </div>
    <h2>Recording defaults</h2>
    <div class="card">
      ${toggle('defaultMic', 'Microphone on by default')}${toggle(
        'defaultSystemAudio',
        'Include system audio by default',
      )}
    </div>
    <h2>Notifications</h2>
    <div class="card">
      ${toggle('notifyLinkReady', 'Notify when a recording is ready')}<label
        class="connected-setting"
        >Long-recording reminder<select data-pref="nudgeMinutes">
          ${[0, 30, 45, 60]
            .map(
              (n) =>
                /* HTML */ `<option
                  value="${n}"
                  ${s.prefs.nudgeMinutes === n ? 'selected' : ''}
                >
                  ${n ? `${n} minutes` : 'Off'}
                </option>`,
            )
            .join('')}
        </select></label
      >
    </div>
    <h2>Appearance and startup</h2>
    <div class="card">
      <label class="connected-setting"
        >Appearance<select data-pref="appearance">
          ${['system', 'light', 'dark']
            .map(
              (value) =>
                /* HTML */ `<option
                  value="${value}"
                  ${s.prefs.appearance === value ? 'selected' : ''}
                >
                  ${value[0].toUpperCase() + value.slice(1)}
                </option>`,
            )
            .join('')}
        </select></label
      >${
        s.loginSupported
          ? toggle('openAtLogin', 'Open Bloom when I log in')
          : '<p class="soft">Login startup can be enabled in the installed app.</p>'
      }
    </div>
    <h2>Permissions</h2>
    <div class="card">
      <p>
        Screen and system audio:
        ${s.permissions.screen ? 'Allowed' : 'Not allowed'}
      </p>
      <p>Microphone: ${s.permissions.mic ? 'Allowed' : 'Not allowed'}</p>
      <button class="btn" data-ui="open-settings">System Settings</button
      >${button('checkPermission', 'Check again')}
    </div>
  </section>`;
}
