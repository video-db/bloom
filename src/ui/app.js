import { bindThumbnails } from './shared/thumbnail.js';
import { clock } from './shared/dom.js';
import { panel } from './panel/panel.js';
import { createOnboarding } from './onboarding/index.js';
import { workspace } from './workspace/workspace.js';
import { control } from './control/control.js';
import { mountCamera } from './camera/bubble.js';
import { releasePlayer, mountPlayer } from './workspace/player.js';
import { bindActions } from './actions.js';

const root = document.querySelector('#root');
bindThumbnails(root);
const surface =
  new URLSearchParams(location.search).get('surface') || 'workspace';
document.body.className = surface;
let state = null,
  shape = '',
  view = location.hash.slice(1) || 'home', // 'home' | 'recordings' | 'recording/<id>' | 'settings'
  previous = 'home', // where Settings goes back to
  drawn = '', // the view the page was last drawn for
  activeId = null,
  browse = { filter: 'all', order: 'newest' }, // how Recordings is being looked at
  tab = 'summary'; // the open recording's tab
// Onboarding runs its own flow; the panel and workspace share the renderer below.
const firstRun = surface === 'onboarding' ? createOnboarding(root) : null;
// The camera picture is put up once and never redrawn, so the camera stays open.
const cameraView = surface === 'camera' ? mountCamera(root) : null;

let redrawAfterFullScreen = false;
function render(force = false) {
  if (!state) return;
  // A redraw would take the video out of full screen; it waits until full screen ends.
  if (document.fullscreenElement) {
    redrawAfterFullScreen = true;
    return;
  }
  const next = JSON.stringify({
    ...state,
    elapsed: 0,
    view,
    activeId,
    browse,
    tab,
  });
  if (force || next !== shape) {
    const focused = root.contains(document.activeElement)
      ? document.activeElement
      : null;
    const focusKey = focused?.dataset.focus;
    const focusValue = focused?.value;
    const range =
      focused?.selectionStart !== undefined
        ? [focused.selectionStart, focused.selectionEnd]
        : null;
    const note = root.querySelector('input[name="note"]')?.value;
    // A redraw of the same page keeps its scroll position.
    const scrolled =
      drawn === view ? root.querySelector('.view')?.scrollTop : 0;
    releasePlayer();
    root.innerHTML =
      surface === 'panel'
        ? panel(state)
        : surface === 'control'
          ? control(state)
          : workspace(state, route(), browse, tab);
    if (note !== undefined && root.querySelector('input[name="note"]'))
      root.querySelector('input[name="note"]').value = note;
    if (focusKey) {
      const target = [...root.querySelectorAll('[data-focus]')].find(
        (el) => el.dataset.focus === focusKey,
      );
      // A field being typed in keeps what was typed.
      if (target && focusValue !== undefined && 'value' in target)
        target.value = focusValue;
      target?.focus();
      if (range && target?.setSelectionRange && target.type !== 'number')
        target.setSelectionRange(...range);
    }
    shape = next;
    drawn = view;
    if (scrolled) root.querySelector('.view')?.scrollTo(0, scrolled);
    // The video is put back on a recording's page, and let go anywhere else.
    mountPlayer(
      route().place === 'recording' && surface === 'workspace'
        ? state.recordings.find((r) => r.id === activeId) ||
            state.browsing?.recordings.find((r) => r.id === activeId)
        : null,
    );
    // The floating control's window is exactly as tall as its buttons.
    if (surface === 'control')
      window.bloom.ui('float-size', {
        height: (root.firstElementChild?.offsetHeight || 0) + 8,
      });
    if (surface === 'panel') {
      const header = root.querySelector('.ph'),
        body = root.querySelector('.pb'),
        footer = root.querySelector('.pf');
      window.bloom.ui('panel-height', {
        height: Math.min(
          640,
          (header?.offsetHeight || 0) +
            (body?.scrollHeight || 0) +
            (footer?.offsetHeight || 0) +
            4,
        ),
      });
    }
  }
  for (const node of root.querySelectorAll('[data-clock]'))
    node.textContent = clock(state.elapsed);
}

const route = () => {
  const [place, id] = view.split('/');
  return { place, id: id || activeId };
};

function go(name) {
  if (name === 'back') name = previous;
  if (name !== 'settings') previous = name;
  view = name;
  const [, id] = name.split('/');
  if (id) {
    activeId = id;
    window.bloom.command('openRecording', { id });
  }
  render(true);
}
bindActions(root, {
  state: () => state,
  browse,
  go,
  setTab(name) {
    tab = name;
    render(true);
  },
  render,
});
window.bloom.onView(go);
const receive = (next) => {
  if (!next) return;
  if (firstRun) return firstRun.receive(next);
  if (cameraView) return cameraView.receive(next);
  state = next;
  render();
};
window.bloom.onState(receive);
window.bloom.getState().then((s) => {
  receive(s);
  window.bloom.ui('main-ready');
});
// Devices and recordings change outside this window. The tray panel re-reads its sources
// and the main window its library each time they come forward, at most every 15 s and only
// between recordings. That is why neither has a Refresh button.
let refreshedAt = 0;
if (['panel', 'workspace'].includes(surface))
  window.addEventListener('focus', () => {
    const between = state && ['idle', 'finished'].includes(state.phase);
    if (
      !between ||
      state.account.status !== 'signed-in' ||
      Date.now() - refreshedAt < 15000
    )
      return;
    refreshedAt = Date.now();
    window.bloom.command(surface === 'panel' ? 'checkConnection' : 'refresh');
  });
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const syncMotion = () =>
  window.bloom.ui('reduced-motion', { value: motion.matches });
motion.addEventListener('change', syncMotion);
syncMotion();
window.addEventListener('beforeunload', releasePlayer);
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement || !redrawAfterFullScreen) return;
  redrawAfterFullScreen = false;
  render(true);
});
