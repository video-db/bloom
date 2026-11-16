// First run: Connect, Permissions, Ready. This file owns the flow: which step is showing,
// what moves on by itself, and what this window has asked macOS for. Views draw it
// (views.js); the engine owns the account, permissions and recorder.
import { connect, permissions, ready, connectStatus } from './views.js';
import { createPreviews } from './previews.js';

const CONNECTED_PAUSE_MS = 650; // long enough to read "Connected", short enough not to wait

export function createOnboarding(root) {
  const previews = createPreviews();
  const flow = {
    step: 0,
    key: '', // kept only until it is accepted, so a wrong key can be corrected in place
    attempted: false, // this window has submitted a key
    cleared: false, // the person typed again after a failed attempt
    screenAsked: false,
    screenReturned: false,
    micAsking: false,
    micAskedAt: 0,
    micDenied: false,
  };
  let state = null;
  let shape = '';
  let advancing = null;
  let settle = false; // the next state answers a question this window asked macOS

  const signedIn = () => state?.account.status === 'signed-in';

  function draw() {
    if (flow.step === 0) return connect(state, flow);
    return flow.step === 1 ? permissions(state, flow) : ready(state);
  }

  function render() {
    if (!state) return;
    const next = JSON.stringify([
      { ...flow, key: !!flow.key },
      state.account.status,
      state.problem,
      state.recorder,
      state.permissions,
      state.loginSupported,
      state.livePreviews,
      state.prefs.openAtLogin,
      state.prefError,
    ]);
    if (next !== shape) {
      const field = root.querySelector('[data-focus="key"]');
      const typing = field && document.activeElement === field;
      const range = typing ? [field.selectionStart, field.selectionEnd] : null;
      root.innerHTML = draw();
      shape = next;
      const again = root.querySelector('[data-focus="key"]');
      if (again) {
        // Set as a property so the key is never written into markup.
        again.value = flow.key;
        if (connectStatus(state, flow) === 'invalid') {
          again.focus();
          again.select();
        } else if (typing && !again.disabled) {
          again.focus();
          again.setSelectionRange(...range);
        }
      }
    }
    const live = flow.step === 1 && state.livePreviews;
    previews.sync(root, {
      screen: live && state.permissions.screen,
      mic: live && state.permissions.mic,
    });
  }

  function goTo(step) {
    flow.step = step;
    render();
  }

  // A good key moves on by itself: there is nothing to decide.
  function followAccount() {
    if (signedIn() && flow.step === 0 && !advancing) {
      const pause = flow.attempted ? CONNECTED_PAUSE_MS : 0; // a restored key has nothing to read
      advancing = setTimeout(() => {
        advancing = null;
        if (!signedIn()) return;
        flow.key = '';
        flow.attempted = false;
        goTo(1);
      }, pause);
    }
    // Signed out, or the key was rejected: only the Connect step makes sense.
    if (!signedIn() && state.account.status !== 'checking' && flow.step > 0)
      flow.step = 0;
  }

  function submit() {
    const key = flow.key.trim();
    if (state.account.status === 'checking') return;
    flow.cleared = false;
    if (!key) {
      // Nothing typed: "Try again" retries the saved key.
      if (state.account.status === 'offline')
        window.bloom.command('checkConnection');
      return;
    }
    flow.attempted = true;
    window.bloom.command('signIn', { key });
  }

  const actions = {
    async paste() {
      flow.key = String((await window.bloom.clipboardText()) || '').trim();
      if (flow.key) submit();
      else root.querySelector('[data-focus="key"]')?.focus();
      render();
    },
    screen() {
      flow.screenAsked = true;
      flow.screenReturned = false;
      window.bloom.command('setPermission', { key: 'screen', value: true });
      window.bloom.ui('open-settings', { key: 'screen' });
      render();
    },
    mic() {
      flow.micAsking = true;
      flow.micAskedAt = Date.now();
      window.bloom.command('setPermission', { key: 'mic', value: true });
      render();
    },
    'change-key'() {
      flow.attempted = false;
      flow.cleared = true; // a deliberate sign-out is not a failed key
      window.bloom.command('signOut');
    },
    continue() {
      // Recording without a microphone is a choice, so the default follows it.
      if (!state.permissions.mic && state.prefs.defaultMic)
        window.bloom.ui('set-pref', { key: 'defaultMic', value: false });
      // Someone who has been through setup before does not need the tour again.
      if (state.prefs.onboardingComplete)
        return window.bloom.ui('onboarding-done');
      goTo(2);
    },
    back: () => goTo(1),
  };

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-act]');
    if (target && !target.disabled) actions[target.dataset.act]?.();
  });
  root.addEventListener('submit', (event) => {
    if (event.target.dataset.form !== 'connect') return;
    event.preventDefault();
    submit();
  });
  // A switch in setup is a checkbox: it saves its preference when it changes.
  root.addEventListener('change', (event) => {
    const { pref } = event.target.dataset;
    if (pref && event.target.type === 'checkbox')
      window.bloom.ui('set-pref', { key: pref, value: event.target.checked });
  });
  root.addEventListener('input', (event) => {
    if (event.target.dataset.focus !== 'key') return;
    flow.key = event.target.value;
    if (['invalid', 'offline'].includes(state.account.status))
      flow.cleared = true;
    render();
  });

  // Coming back to the window is when a macOS answer can have changed.
  window.addEventListener('focus', () => {
    if (flow.step !== 1) return;
    settle = flow.screenAsked || flow.micAsking;
    window.bloom.command('checkPermission');
  });
  // The macOS microphone question does not always take focus away, so its answer may come
  // with no focus change. Look once a second while the question is open.
  setInterval(() => {
    if (flow.step === 1 && flow.micAsking)
      window.bloom.command('checkPermission');
  }, 1000);
  window.addEventListener('beforeunload', previews.stop);

  return {
    receive(next) {
      state = next;
      // The macOS microphone question takes focus; an update that arrives once this
      // window has it back is the answer.
      // While macOS is still asking, there is no answer to show yet.
      const decided =
        state.permissions.mic || state.permissions.micDecided !== false;
      const answered =
        flow.micAsking &&
        decided &&
        (state.permissions.mic ||
          (document.hasFocus() && Date.now() - flow.micAskedAt > 800));
      if (settle || answered) {
        settle = false;
        flow.screenReturned = flow.screenAsked && !state.permissions.screen;
        if (flow.micAsking && decided) {
          flow.micAsking = false;
          flow.micDenied = !state.permissions.mic;
        }
      }
      followAccount();
      render();
    },
  };
}
