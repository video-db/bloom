// First run: permissions, a short sample recording, then the tray.
// Sign-in and permission grants are simulated in this preview.
const root = $('#root');
let step = 0;
let state = null;
let shape = '';
let perms = { screen: false, mic: false };
let permissionFocus = null;
let ownsTest = false;
let testSession = null;
let pendingTestSession = null;
const activeTest = () =>
  state &&
  [
    'starting',
    'recording',
    'paused',
    'saving',
    'stopped',
    'processing-error',
  ].includes(state.phase);

const dots = () =>
  `<div class="steps" role="img" aria-label="Step ${step + 1} of 4">${[0, 1, 2, 3].map((i) => `<i aria-hidden="true" class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
const heading = (text) =>
  `<h1 tabindex="-1" data-focus="step-heading" style="margin-top:8px">${text}</h1>`;
const saveError = () =>
  state?.prefError
    ? `<div class="note nodrag" role="alert">${esc(state.prefError)}</div>`
    : '';
const captureButton = (command, label, primary = true) =>
  `<button class="btn ${primary ? 'pri' : 'quiet'} nodrag" data-cmd="${command}" data-focus="${primary ? 'capture-primary' : 'capture-secondary'}">${label}</button>`;

function testControls(s) {
  if (s.phase === 'starting')
    return captureButton('cancel', 'Cancel starting', false);
  if (s.phase === 'recording')
    return captureButton('stop', `${icon('stop')} Stop test recording`);
  if (s.phase === 'paused')
    return `<div class="row2">${captureButton('resume', 'Resume')}${captureButton('stop', 'Stop', false)}</div>`;
  if (s.phase === 'stopped')
    return `<div class="row2">${captureButton('retry', 'Try again')}${captureButton('keep', 'Keep recording so far', false)}</div>`;
  if (s.phase === 'processing-error')
    return captureButton('retryProcessing', 'Retry processing');
  if (s.phase === 'saving')
    return '<div class="note" role="status" tabindex="-1" data-focus="capture-status">Preparing your sample recording…</div>';
  if (!perms.screen || s.problem?.kind === 'permission')
    return '<button class="btn pri nodrag" data-review-permissions data-focus="capture-primary">Review screen permission</button>';
  return captureButton('start', `${mark('brand')} Start a test recording`);
}

function testMessage(s) {
  if (s.phase === 'paused')
    return 'Paused. Nothing is being captured. Resume or finish the test.';
  if (s.phase === 'stopped')
    return 'The sample connection was interrupted. Retry or keep the recording so far.';
  if (s.phase === 'processing-error')
    return 'Processing failed. Your sample session is still here; retry to finish preparing it.';
  if (s.problem?.kind === 'stop-failed')
    return 'Stop failed in this simulation. Recording remains active; try Stop again.';
  if (s.problem?.kind === 'upload-slow')
    return 'Upload is delayed in this simulation. Recording remains active.';
  if (!perms.screen || s.problem?.kind === 'permission')
    return 'Allow screen recording before starting the test.';
  return '';
}

const steps = [
  () => `${dots()}
    <div class="hero" style="margin:14px 0 4px">${mark('brand')}</div>
    ${heading('Welcome to Bloom')}
    <p>Record your screen once. Get a link, a transcript and a cut you can edit by deleting words.</p>
    <button class="btn pri big nodrag" data-next data-focus="continue-videodb">Continue with VideoDB</button>
    <button class="btn nodrag" data-next data-focus="continue-key" style="padding:10px">Use an API key instead</button>
    <div class="note" style="text-align:left;margin-top:6px">This preview does not record or upload anything. Storage and sharing access will be confirmed when connected.</div>
    <span class="soft" style="font-size:11.5px;margin-top:auto">Preview build · sign-in is not real yet</span>`,

  () => `${dots()}
    ${heading('What Bloom may capture')}
    <p>You can change any of this later from the tray.</p>
    <div class="nodrag">
      <div class="perm"><div><b>Screen and system audio</b><small>Needed to record. One macOS permission covers both.</small></div>${perms.screen ? '<span class="chip ok">✓ Allowed</span>' : '<button class="btn sm pri" data-perm="screen" data-focus="permission-screen" aria-label="Allow screen and system audio">Allow</button>'}</div>
      <div class="perm"><div><b>Microphone</b><small>Optional, for your narration.</small></div>${perms.mic ? '<span class="chip ok">✓ Allowed</span>' : '<button class="btn sm" data-perm="mic" data-focus="permission-mic" aria-label="Allow microphone">Allow</button>'}</div>
      <div class="perm" style="border-bottom:0"><div><b>Camera</b><small>Asked only if you turn the camera on.</small></div><span class="soft">Later</span></div>
      <div class="note" style="text-align:left">Whether a recording includes system audio is a choice in the tray panel. It is off until you turn it on.</div>
    </div>
    <div class="foot nodrag"><button class="btn quiet" data-back data-focus="back">Back</button><button class="btn pri" data-next data-focus="continue" style="flex:2" ${perms.screen ? '' : 'disabled'}>Continue</button></div>`,

  () => {
    const s = state || { phase: 'idle', elapsed: 0, live: [] };
    const status =
      {
        idle: 'Not recording',
        starting: 'Starting',
        recording: 'Sample capture',
        paused: 'Paused',
        stopped: 'Recording stopped',
        saving: 'Preparing recording',
        'processing-error': 'Processing failed',
        finished: 'Finished',
      }[s.phase] || 'Not recording';
    const indicator =
      s.phase === 'recording'
        ? 'rec'
        : ['starting', 'saving'].includes(s.phase)
          ? 'busy'
          : 'brand';
    const message = testMessage(s);
    return `${dots()}
    ${heading('Try a ten-second recording')}
    <p>Say a sentence and click around. This preview uses sample speech.</p>
    <div class="demo nodrag">
      <div class="mk">${mark(indicator)}<span class="timer" style="font-size:17px" data-clock>${clock(s.elapsed)}</span><span class="soft" role="status" style="margin-left:auto">${status}</span></div>
      <div class="live" data-live></div>
    </div>
    ${message ? `<div class="note" role="status">${esc(message)}</div>` : ''}
    ${testControls(s)}
    <button class="link nodrag" data-next data-focus="skip" ${activeTest() ? 'disabled' : ''} style="color:var(--soft);align-self:center">Skip, I’ll record later</button>
    <div class="foot nodrag"><button class="btn quiet" data-back data-focus="back" ${activeTest() ? 'disabled' : ''}>Back</button></div>`;
  },

  () => `${dots()}
    ${heading('That’s it. Bloom lives in your tray.')}
    ${
      state?.result
        ? `<div class="demo nodrag"><div class="rc" style="grid-template-columns:72px 1fr"><div class="shot"></div><div><b style="font-size:13px">${esc(state.result.title)}</b><small>${short(state.result.duration)} · sample recording</small></div></div>
      <div class="row2"><button class="btn sm" data-ui="open-main" data-view="detail" data-id="${state.result.id}" data-focus="review">Review recording</button><button class="btn sm" data-ui="open-main" data-view="editor" data-id="${state.result.id}" data-focus="open-editor" ${state.result.stage < 2 ? 'disabled' : ''}>Open in editor</button></div></div>`
        : ''
    }
    <div class="trayhint"><span style="font-size:22px">${mark('')}</span><span>Click the flower in the menu bar, or press <b>⇧⌘R</b> anywhere, to record.</span></div>
    <label class="nodrag" style="display:flex;gap:8px;align-items:center;justify-content:center;font-size:12.5px"><input type="checkbox" id="login" data-focus="login" ${state?.prefs.openAtLogin ? 'checked' : ''}> Open Bloom when I log in (saved choice; preview only)</label>
    ${saveError()}
    <div class="foot nodrag"><button class="btn pri" data-ui="onboarding-done" data-focus="done">Done</button></div>`,
];

function render(force = false, focusTarget = null) {
  const s = state || {};
  const next = JSON.stringify([
    step,
    perms,
    s.phase,
    s.problem,
    step === 3 ? s.result : null,
    s.prefs?.openAtLogin,
    s.prefError,
  ]);
  if (force || next !== shape) {
    const focused = root.contains(document.activeElement)
      ? document.activeElement.dataset.focus
      : null;
    root.innerHTML = steps[step]();
    shape = next;
    let target = focusTarget || focused;
    if (
      permissionFocus &&
      !root.querySelector(`[data-focus="permission-${permissionFocus}"]`)
    ) {
      target =
        permissionFocus === 'screen' && !perms.mic
          ? 'permission-mic'
          : 'continue';
      permissionFocus = null;
    }
    if (target) {
      let element = root.querySelector(`[data-focus="${target}"]`);
      if (!element || element.disabled)
        element = root.querySelector(
          '[data-focus="capture-primary"], [data-focus="capture-status"], [data-focus="step-heading"]',
        );
      element?.focus({ preventScroll: true });
    }
  }
  const c = $('[data-clock]');
  if (c) c.textContent = clock(s.elapsed || 0);
  const live = $('[data-live]');
  if (live)
    live.innerHTML = (s.live || []).length
      ? s.live
          .map((line, i) =>
            i === s.live.length - 1
              ? `<b>${esc(line)}</b>`
              : `${esc(line)}<br>`,
          )
          .join('')
      : s.sources?.mic
        ? '<span>Sample words will appear while recording.</span>'
        : '<span>Microphone is off. The test can record silently.</span>';
}

document.addEventListener('click', (event) => {
  const t = event.target;
  const command = t.closest('[data-cmd]')?.dataset.cmd;
  if (
    command === 'start' &&
    ['idle', 'finished'].includes(state?.phase) &&
    perms.screen
  ) {
    ownsTest = true;
    testSession = null;
    pendingTestSession = state.sessionId;
  }
  if (command === 'cancel') {
    ownsTest = false;
    testSession = null;
  }
  const next = t.closest('[data-next]');
  const back = t.closest('[data-back]');
  if (next && !next.disabled && !(step === 2 && activeTest())) {
    step = Math.min(3, step + 1);
    render(true, 'step-heading');
  }
  if (back && !back.disabled && !(step === 2 && activeTest())) {
    step = Math.max(0, step - 1);
    render(true, 'step-heading');
  }
  if (t.closest('[data-review-permissions]')) {
    step = 1;
    render(true, 'step-heading');
  }
  const p = t.closest('[data-perm]');
  if (p) {
    permissionFocus = p.dataset.perm;
    window.bloom.command('setPermission', { key: p.dataset.perm, value: true });
  }
});

window.bloom.onState((s) => {
  const was = state?.phase;
  state = s;
  perms = s.permissions;
  if (
    ownsTest &&
    !testSession &&
    s.phase === 'starting' &&
    s.sessionId !== pendingTestSession
  )
    testSession = s.sessionId;
  if (s.phase === 'idle' || (testSession && s.sessionId !== testSession)) {
    ownsTest = false;
    testSession = null;
  }
  if (
    ownsTest &&
    testSession &&
    step === 2 &&
    s.phase === 'recording' &&
    s.elapsed >= 10
  )
    window.bloom.command('stop');
  const completed =
    ownsTest &&
    testSession &&
    step === 2 &&
    was === 'saving' &&
    s.phase === 'finished';
  if (completed) ownsTest = false;
  if (completed) step = 3;
  render(false, completed ? 'step-heading' : null);
});
window.bloom.getState().then((s) => {
  state = s;
  perms = s.permissions;
  render(true);
});

document.addEventListener('change', (event) => {
  if (event.target.id !== 'login') return;
  const value = event.target.checked;
  // Reflect only confirmed persistence; a failed write must not leave a checked control behind.
  event.target.checked = !!state?.prefs.openAtLogin;
  window.bloom.ui('set-pref', { key: 'openAtLogin', value });
});
