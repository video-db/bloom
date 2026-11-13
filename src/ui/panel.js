// Tray panel: every capture state in one small surface.
// The structure is re-rendered only when the state's shape changes; the clock, live lines and
// marks update in place so animations and typing are never interrupted by the once-a-second tick.
const root = $('#root');
let shape = '',
  latest = null,
  displayOpen = false;

const SAMPLE = () =>
  `<div class="sample"><span>Preview · nothing is recorded</span><button class="tray-gear" data-ui="open-preferences" aria-label="Settings" title="Settings (⌘,)">${icon('settings')}</button></div>`;

const views = {
  idle: (s) =>
    s.problem && s.problem.kind === 'permission'
      ? `
    <div class="ph warn"><span>${icon('warning')} Bloom can’t see your screen</span></div>
    <div class="pb">
      <div><b>Screen recording is turned off for Bloom.</b><br><span class="soft">Turn it on in System Settings, Privacy &amp; Security, Screen Recording.</span></div>
      <div class="row2"><button class="btn pri" data-ui="open-settings">Open Settings</button><button class="btn quiet" data-cmd="checkPermission">Check again</button></div>
      <span class="soft" style="font-size:12px">Recording stays disabled until this is on.</span>
    </div>${SAMPLE()}`
      : `
    <div class="ph"><span class="brandname">${mark('brand')} Bloom</span><button class="link" data-ui="open-main" data-view="library">Recordings ${icon('open-external')}</button></div>
    <div class="pb">
      ${s.prefs.askPurpose ? `<input aria-label="Recording title (optional)" class="field" id="purpose" placeholder="Recording title (optional)" value="${esc(s.purpose)}" maxlength="180">` : ''}
      ${sourceControls(s)}
      <button class="btn pri capture-start" data-cmd="start">${mark('')}<span>Start recording</span><kbd>⇧⌘R</kbd></button>
      <span class="label">Recent</span>
      ${s.recent
        .slice(0, 2)
        .map(
          (r, i) =>
            `<button class="rc" data-ui="open-main" data-view="detail" data-id="${r.id}"><div class="shot ${i ? 'modal' : ''}"></div><div>${esc(r.title)}<small>${esc(r.meta)}</small></div></button>`,
        )
        .join('')}
    </div>
    ${SAMPLE()}`,

  starting: () => `
    <div class="ph"><span class="brandname">${mark('busy')} Starting</span></div>
    <div class="pb"><div><b>Not capturing yet.</b><br><span class="soft">Bloom is opening your recording sources.</span></div>
      <button class="btn quiet" data-cmd="cancel">Cancel</button></div>${SAMPLE()}`,

  recording: (s) => `
    <div class="ph"><span style="display:inline-flex;align-items:center;gap:8px">${mark('rec')}<span class="timer" data-clock></span></span><span class="mid">Recording</span><button class="link soft" data-ui="close-panel" style="color:var(--soft)">Close</button></div>
    <div class="pb">
      ${s.problem ? `<div role="alert" class="note">${s.problem.kind === 'stop-failed' ? 'Stop failed (sample). Recording is still active. Try Stop again.' : 'Upload delayed (sample). Recording continues; cloud save is not confirmed.'}</div>` : ''}
      ${
        s.ask
          ? `<div class="askbox"><b>Looks like your meeting ended</b><span>The camera turned off and nobody has spoken for 40 seconds.</span></div>
        <button class="btn pri" data-cmd="answerAsk" data-stop="true">${icon('stop')} Stop recording</button>
        <button class="btn" data-cmd="answerAsk" data-stop="false">Keep recording</button>
        <label><input type="checkbox" id="trim-ending" ${s.trimEnding !== false ? 'checked' : ''}> Trim quiet ending (0:40)</label><span class="soft" style="font-size:12px">Still recording until you choose. Trimming is reversible in the editor.</span>`
          : `
      ${sourceControls(s, true)}
      <span class="label">${s.sources.mic || s.sources.systemAudio ? 'Transcript preview' : 'Audio is off'}</span>
      <div class="live" data-live></div>
      <span class="label">Your marks</span>
      <div data-marks style="display:flex;flex-direction:column;gap:6px"></div>
      <input aria-label="Mark a moment" class="field" id="note" placeholder="Type a note. ↵ marks this moment">
      <div class="row3"><button class="btn quiet" data-cmd="pause">${icon('pause')} Pause</button><button class="btn quiet" data-cmd="mark">${icon('mark')} Mark</button><button class="btn pri" data-cmd="stop">${icon('stop')} Stop</button></div>`
      }
    </div>${SAMPLE()}`,

  paused: (s) => `
    <div class="ph warn"><span>${icon('pause')} Paused at <span data-clock></span></span></div>
    <div class="pb">${sourceControls(s, true)}<div><b>Nothing is being captured.</b><br><span class="soft">Your sample session is retained. Resume when you’re ready.</span></div>
      <div class="row2"><button class="btn pri" data-cmd="resume">Resume</button><button class="btn quiet" data-cmd="stop">${icon('stop')} Stop</button></div>
      <span class="soft" style="font-size:12px">Marks are off while paused.</span></div>${SAMPLE()}`,

  stopped: (s) => `
    <div class="ph warn"><span>${icon('warning')} Connection lost at ${clock(s.problem.at)}</span></div>
    <div class="pb"><div><b>Recording stopped.</b><br><span class="soft">This simulates a connection loss. In a connected build, recovery will show the last confirmed saved point.</span></div>
      <div class="row2"><button class="btn pri" data-cmd="retry">Try again</button><button class="btn quiet" data-cmd="keep">Keep ${clock(s.problem.at)}</button></div>
      <span class="soft" style="font-size:12px">Bloom will not resume by itself.</span></div>${SAMPLE()}`,

  saving: (s) => `
    <div class="ph"><span class="brandname">${mark('busy')} Saving ${short(s.elapsed)}</span></div>
    <div class="pb"><div><b>Not recording.</b><br><span class="soft">Preparing your sample recording.</span></div></div>${SAMPLE()}`,

  'processing-error': () =>
    `<div class="ph warn">Processing failed (sample)</div><div class="pb"><p>Capture has stopped. Your sample session is retained; retry preparing it.</p><button class="btn pri" data-cmd="retryProcessing">Retry processing</button></div>${SAMPLE()}`,

  finished: (s) => `
    <div class="ph"><span class="brandname">${mark('brand')} Bloom</span><button class="link" data-cmd="newRecording" style="color:var(--soft)">New recording <kbd>⇧⌘R</kbd></button></div>
    <div class="pb">
      <div class="rc result-card"><div class="shot modal"><span class="ts">${short(s.result.duration)}</span></div><div><input class="field" id="recording-title" aria-label="Recording title" maxlength="180" value="${esc(s.result.title)}"><small>${esc(s.sources.screen)}${s.sources.mic ? ' · microphone' : ''}${s.marks.length ? ` · ${s.marks.length} mark${s.marks.length > 1 ? 's' : ''}` : ''}</small></div></div>
      <div class="stages">${['Sample', 'Summary', 'Editor'].map((n, i) => `<div class="${i <= s.result.stage ? 'done' : ''}"><b>${n}</b>${i <= s.result.stage ? 'ready' : i === 1 ? 'reading' : 'preparing'}</div>`).join('')}</div>
      <div class="mid" style="font-size:12.5px;min-height:58px">${s.result.stage === 0 ? 'Sample prepared. The summary and editor will be ready shortly.' : esc(s.result.summary) + (s.result.stage === 2 ? '<br><b>Ready to review:</b> sample transcript and your marks.' : '')}</div>
      <div class="row2" style="grid-template-columns:auto 1fr"><button class="btn" data-ui="open-main" data-view="detail" data-id="${s.result.id}">Review</button><button class="btn pri" data-ui="open-main" data-view="editor" data-id="${s.result.id}" ${s.result.stage < 2 ? 'disabled' : ''}>Open in editor →</button></div>
    </div>
    <div class="pf"><span>Sample recording · not uploaded</span><button data-cmd="discard">Delete</button></div>${SAMPLE()}`,
};

function sourceControls(s, readOnly = false) {
  const fields = [
    ['mic', 'microphone', 'Microphone'],
    ['systemAudio', 'audio', 'System sound'],
    ['camera', 'camera', 'Camera'],
  ];
  const number = s.sources.screen.includes('2') ? 2 : 1;
  const display = `<button class="capture-option display-option on" id="display-picker" aria-label="Display ${number}${readOnly ? ': recording source' : ': choose display'}" aria-expanded="${displayOpen}" aria-controls="display-choices" data-tooltip="Display ${number}" ${readOnly ? 'disabled' : ''}>${icon('screen')}<span class="display-number">${number}</span></button>`;
  return `<div class="source-group"><div class="capture-options" role="group" aria-label="Capture sources">${display}<span class="source-divider"></span>${fields
    .map(([key, glyph, label]) => {
      const allowed =
        key === 'systemAudio'
          ? s.permissions.screen
          : s.permissions[key] !== false;
      const on = !!s.sources[key];
      const state = !allowed
        ? 'blocked'
        : !on
          ? 'off'
          : s.phase === 'recording'
            ? 'recording'
            : s.phase === 'paused'
              ? 'paused'
              : 'on';
      const stateLabel = {
        blocked: 'Permission required',
        off: 'Off',
        recording: 'Recording',
        paused: 'Paused',
        on: 'On',
      }[state];
      const attributes = !allowed
        ? `data-cmd="setPermission" data-key="${key}" data-value="true"`
        : `data-cmd="setSource" data-key="${key}" data-value="${!on}"`;
      return `<button class="capture-option ${state}" ${readOnly ? 'disabled' : attributes} aria-pressed="${on && allowed}" aria-label="${label}: ${stateLabel}" data-tooltip="${label}: ${stateLabel}">${icon(glyph)}${!on || !allowed ? '<span class="source-slash"></span>' : ''}</button>`;
    })
    .join(
      '',
    )}</div>${displayOpen && !readOnly ? displayChoices(number) : ''}</div>`;
}
function displayChoices(selected) {
  return `<section class="display-choices" id="display-choices" aria-label="Choose a display"><div class="display-chooser-heading"><b>Choose a display</b><span>Sample arrangement</span></div><div class="display-map" role="group" aria-label="Available displays">${[1, 2].map((n) => `<button class="display-tile display-${n} ${n === selected ? 'selected' : ''}" data-display="${n}" aria-pressed="${n === selected}" aria-label="Display ${n}${n === 1 ? ', built-in' : ', external (sample)'}"><span class="mini-desktop"><span>${n}</span>${n === selected ? '<i>✓</i>' : ''}</span><b>${n === 1 ? 'Built-in' : 'External'}</b><small>${n === 1 ? 'Display 1' : 'Display 2 · sample'}</small></button>`).join('')}</div><p>Choose the screen you want to record.</p></section>`;
}

function render(s) {
  latest = s;
  if (s.phase !== 'idle') displayOpen = false;
  const next = JSON.stringify([
    displayOpen,
    s.phase,
    s.ask,
    s.problem,
    s.result && [s.result.stage, s.result.title],
    s.sources,
    s.phase === 'finished' ? s.marks.length : 0,
    s.prefs.askPurpose,
    s.permissions,
    s.recent,
  ]);
  if (next !== shape) {
    const focused = document.activeElement,
      hadFocus = root.contains(focused),
      focusKey = focused?.dataset?.key;
    const focusId = focused?.id,
      focusCommand = focused?.dataset?.cmd;
    const purpose = $('#purpose'),
      purposeKeep =
        purpose && focused === purpose
          ? {
              value: purpose.value,
              start: purpose.selectionStart,
              end: purpose.selectionEnd,
            }
          : null;
    const title = $('#recording-title'),
      titleKeep =
        title && document.activeElement === title
          ? {
              value: title.value,
              start: title.selectionStart,
              end: title.selectionEnd,
            }
          : null;
    const note = $('#note'),
      keep = note
        ? { value: note.value, focused: document.activeElement === note }
        : null;
    root.innerHTML = (views[s.phase] || views.idle)(s);
    shape = next;
    if (hadFocus && !purposeKeep) {
      const same = focusKey
        ? $(`[data-key="${focusKey}"]`)
        : focusId
          ? document.getElementById(focusId)
          : focusCommand
            ? $(`[data-cmd="${focusCommand}"]`)
            : null;
      const primary = {
        starting: 'cancel',
        recording: s.ask ? 'answerAsk' : 'stop',
        paused: 'resume',
        stopped: 'retry',
        saving: null,
        'processing-error': 'retryProcessing',
        finished: 'newRecording',
        idle: 'start',
      }[s.phase];
      const fallback = primary ? $(`[data-cmd="${primary}"]`) : $('.ph');
      if (fallback && !fallback.matches('button,input')) fallback.tabIndex = -1;
      (same || fallback)?.focus({ preventScroll: true });
    }
    if (purposeKeep && $('#purpose')) {
      $('#purpose').value = purposeKeep.value;
      $('#purpose').focus();
      $('#purpose').setSelectionRange(purposeKeep.start, purposeKeep.end);
    }
    const titleAgain = $('#recording-title');
    if (titleAgain && titleKeep) {
      titleAgain.value = titleKeep.value;
      titleAgain.focus();
      titleAgain.setSelectionRange(titleKeep.start, titleKeep.end);
    }
    const again = $('#note');
    if (again && keep) {
      again.value = keep.value;
      if (keep.focused) again.focus();
    }
    window.bloom.ui('panel-height', {
      height: [...root.children].reduce(
        (h, el) => h + Math.max(el.scrollHeight, el.offsetHeight),
        0,
      ),
    });
  }
  $$('[data-clock]').forEach((el) => {
    el.textContent = clock(s.elapsed);
  });
  const live = $('[data-live]');
  if (live)
    live.innerHTML = s.live.length
      ? s.live
          .map((line, i) =>
            i === s.live.length - 1
              ? `<b>${esc(line)}</b>`
              : `${esc(line)}<br>`,
          )
          .join('')
      : s.sources.mic || s.sources.systemAudio
        ? '<span>Waiting for sample speech…</span>'
        : '<span>No audio source selected.</span>';
  const marks = $('[data-marks]');
  if (marks) {
    const html = s.marks.length
      ? s.marks
          .map(
            (m) =>
              `<div class="mk"><span class="ts">${clock(m.at)}</span>${m.text ? esc(m.text) : '<span class="soft">Marked</span>'}</div>`,
          )
          .join('')
      : '<span class="soft" style="font-size:12.5px">None yet. Press ⇧⌘M or type a note.</span>';
    if (marks.innerHTML !== html) {
      marks.innerHTML = html;
      window.bloom.ui('panel-height', {
        height: [...root.children].reduce(
          (h, el) => h + Math.max(el.scrollHeight, el.offsetHeight),
          0,
        ),
      });
    }
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.id === 'note') {
    window.bloom.command('mark', { text: event.target.value });
    event.target.value = '';
  }
  if (event.key === 'Escape') {
    if (displayOpen) {
      displayOpen = false;
      render(latest);
      $('#display-picker')?.focus();
    } else window.bloom.ui('close-panel');
  }
});
document.addEventListener('change', (event) => {
  if (event.target.dataset.source)
    window.bloom.command('setSource', {
      key: event.target.dataset.source,
      value: event.target.value,
    });
  if (event.target.id === 'trim-ending')
    window.bloom.command('trimEnding', { value: event.target.checked });
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'recording-title')
    window.bloom.command('rename', { text: event.target.value });
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'purpose')
    window.bloom.command('setPurpose', { text: event.target.value });
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button?.id === 'display-picker') {
    displayOpen = !displayOpen;
    render(latest);
    (displayOpen
      ? $('[data-display][aria-pressed=true]')
      : $('#display-picker')
    )?.focus();
    return;
  }
  if (button?.dataset.display) {
    displayOpen = false;
    window.bloom.command('setSource', {
      key: 'screen',
      value:
        button.dataset.display === '1' ? 'Display 1' : 'Display 2 (sample)',
    });
    render(latest);
    $('#display-picker')?.focus();
    return;
  }
  if (displayOpen && !event.target.closest('.source-group')) {
    displayOpen = false;
    render(latest);
  }
});

window.bloom.onState(render);
window.bloom.getState().then(render);
