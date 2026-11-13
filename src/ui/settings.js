const prefLabels = {
  defaultMic: 'Microphone on by default',
  defaultSystemAudio: 'Include system audio by default',
  defaultCamera: 'Camera on by default',
  askPurpose: 'Show an optional recording title',
  autoSilences: 'Remove silences',
  autoFiller: 'Remove filler words',
  autoChapters: 'Add chapters',
  autoCaptions: 'Add captions',
  notifyLinkReady: 'Link ready notifications',
  notifyMeetingEnded: 'Meeting ended notifications',
  openAtLogin: 'Open Bloom when I log in',
};
const tgl = (key, on) =>
  `<button class="tgl ${on ? 'on' : ''}" data-ui="set-pref" data-key="${key}" data-value="${!on}" aria-pressed="${on}" aria-label="${prefLabels[key] || key}"></button>`;
const seg = (key, value, options) =>
  `<span class="seg" role="group" aria-label="${key === 'appearance' ? 'Appearance' : 'Reminder interval'}">${options.map(([v, label]) => `<button class="${v === value ? 'on' : ''}" aria-pressed="${v === value}" data-ui="set-pref" data-key="${key}" data-value="${v}">${label}</button>`).join('')}</span>`;
const srow = (name, hint, control) =>
  `<div class="srow"><div><b>${name}</b>${hint ? `<small>${hint}</small>` : ''}</div>${control}</div>`;

function settings() {
  const p = latest.prefs;
  const top = view.scrollTop;
  const focused = document.activeElement?.dataset;
  const focusKey = focused?.key,
    focusValue = focused?.value;
  view.innerHTML = `<div class="set">
    <div class="settings-heading"><button class="icon-button" data-go="library" aria-label="Back to recording">←</button><h1>Settings</h1></div>
    ${latest.prefError ? `<p role="alert">${esc(latest.prefError)}</p>` : ''}
    <span class="soft" style="font-size:12.5px">Preferences are saved on this Mac. Capture permissions are simulated in this preview; account and login integration are not connected.</span>

    <h2>Recording</h2>
    <div class="card">
      ${srow('Microphone on by default', 'Your narration. You can still turn it off for one recording in the tray panel.', tgl('defaultMic', p.defaultMic))}
      ${srow('Include system audio by default', 'Meetings and app sound. Covered by the same macOS permission as the screen.', tgl('defaultSystemAudio', p.defaultSystemAudio))}
      ${srow('Camera on by default', 'macOS asks for camera access the first time.', tgl('defaultCamera', p.defaultCamera))}
      ${srow('Show an optional recording title', 'Name your recording before starting. You can also rename it later.', tgl('askPurpose', p.askPurpose))}
      ${srow('Shortcuts', 'Start or stop <kbd>⇧⌘R</kbd> · Mark a moment <kbd>⇧⌘M</kbd>', '<span class="soft">Fixed for now</span>')}
    </div>

    <h2>After recording</h2>
    <div class="card">
      ${srow('Remove silences', 'Applied when the editor opens. Each one can be undone there.', tgl('autoSilences', p.autoSilences))}
      ${srow('Remove filler words', '', tgl('autoFiller', p.autoFiller))}
      ${srow('Add chapters', 'From your marks and the transcript.', tgl('autoChapters', p.autoChapters))}
      ${srow('Add captions', '', tgl('autoCaptions', p.autoCaptions))}
    </div>

    <h2>Notifications</h2>
    <div class="card">
      ${srow('Link ready', 'Only when Bloom is out of sight.', tgl('notifyLinkReady', p.notifyLinkReady))}
      ${srow('Ask to stop when a meeting ends', 'Bloom offers; it never stops by itself.', tgl('notifyMeetingEnded', p.notifyMeetingEnded))}
      ${srow(
        'Remind me about a long recording',
        'One reminder, so a forgotten recording does not keep running.',
        seg('nudgeMinutes', p.nudgeMinutes, [
          [0, 'Off'],
          [30, '30 min'],
          [45, '45 min'],
          [60, '1 hour'],
        ]),
      )}
    </div>

    <h2>Privacy and storage</h2>
    <div class="card">
      ${srow('Where recordings go', 'No recordings leave this preview. Cloud storage and sharing access will be shown when connected.', '<span class="soft">VideoDB</span>')}
      ${srow('Screen and system audio', 'macOS permission. Needed to record.', `<span class="chip">${latest.permissions.screen ? 'Allowed (sample)' : 'Not allowed (sample)'}</span>`)}
      ${srow('Microphone', 'macOS permission.', `<span class="chip ${latest.permissions.mic ? 'ok' : ''}">${latest.permissions.mic ? 'Allowed (sample)' : 'Not allowed (sample)'}</span>`)}
      ${srow('Change permissions', 'Opens System Settings, Privacy &amp; Security.', '<button class="btn sm" data-ui="open-settings">Open System Settings</button>')}
    </div>

    <h2>Account</h2>
    <div class="card">
      ${srow('VideoDB account', 'No account is connected in this sample workspace.', '<span class="soft">Not connected</span>')}
      ${srow('Connection', 'Account setup will be available in the connected app.', '<span class="soft">Preview only</span>')}
    </div>

    <h2>General</h2>
    <div class="card">
      ${srow(
        'Appearance',
        'Follows macOS unless you choose.',
        seg('appearance', p.appearance, [
          ['system', 'System'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ]),
      )}
      ${srow('Open Bloom when I log in', 'Choice saved; activation requires the packaged app.', tgl('openAtLogin', p.openAtLogin))}
      ${srow('Version', 'Preview build of the new interface · sample data', '<button class="btn sm quiet" data-ui="open-onboarding">Replay onboarding</button>')}
    </div>
  </div>`;
  view.scrollTop = top;
  if (focusKey) {
    const controls = $$('[data-key]', view);
    (
      controls.find(
        (el) => el.dataset.key === focusKey && el.dataset.value === focusValue,
      ) || controls.find((el) => el.dataset.key === focusKey)
    )?.focus({ preventScroll: true });
  }
}
