import { esc, clock } from './dom.js';
import { panel } from './panel.js';
import { chooser } from './sources.js';
import { createOnboarding } from './onboarding/index.js';
import { workspace } from './workspace.js';
import { releasePlayer, mountPlayer, seek } from './player.js';

const root = document.querySelector('#root');
const surface =
  new URLSearchParams(location.search).get('surface') || 'workspace';
document.body.className = surface;
let state = null,
  shape = '',
  view = location.hash.slice(1) || 'library',
  activeId = null,
  list = { query: '', filter: 'all', order: 'newest' }; // how the main window browses
// Onboarding runs its own flow; the panel and workspace share the renderer below.
const firstRun = surface === 'onboarding' ? createOnboarding(root) : null;

function render(force = false) {
  if (!state) return;
  const next = JSON.stringify({
    ...state,
    elapsed: 0,
    view,
    activeId,
    list,
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
    releasePlayer();
    root.innerHTML =
      surface === 'panel'
        ? panel(state)
        : workspace(state, view, activeId, list);
    if (note !== undefined && root.querySelector('input[name="note"]'))
      root.querySelector('input[name="note"]').value = note;
    if (focusKey) {
      const target = [...root.querySelectorAll('[data-focus]')].find(
        (el) => el.dataset.focus === focusKey,
      );
      if (target && focusKey === 'note') target.value = focusValue;
      target?.focus();
      if (range && target?.setSelectionRange && target.type !== 'number')
        target.setSelectionRange(...range);
    }
    shape = next;
    mountPlayer(state.recordings.find((r) => r.id === activeId));
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

function go(name) {
  view = name;
  const [, id] = name.split('/');
  if (id) {
    activeId = id;
    window.bloom.command('openRecording', { id });
  }
  render(true);
}
function dialog(action, id) {
  const record = state.recordings.find((r) => r.id === id);
  if (!record) return;
  const modal = document.createElement('dialog');
  modal.innerHTML = /* HTML */ `<form method="dialog">
    <h2>${action === 'delete' ? 'Delete recording?' : 'Rename recording'}</h2>
    ${
      action === 'rename'
        ? /* HTML */ `<label
            >Recording name<input
              class="field"
              name="title"
              maxlength="180"
              value="${esc(record.title)}"
              required
          /></label>`
        : /* HTML */ `<p>
            Delete “${esc(record.title)}” from VideoDB? This cannot be undone.
          </p>`
    }
    <div class="dialog-actions">
      <button class="btn" value="cancel" formnovalidate>Cancel</button
      ><button
        class="btn ${action === 'delete' ? 'danger' : 'pri'}"
        value="confirm"
      >
        ${action === 'delete' ? 'Delete' : 'Save'}
      </button>
    </div>
  </form>`;
  document.body.append(modal);
  modal.showModal();
  modal.addEventListener(
    'close',
    () => {
      if (modal.returnValue === 'confirm') {
        if (action === 'delete')
          window.bloom.command('deleteRecording', { id });
        else
          window.bloom.command('renameRecording', {
            id,
            text: modal.querySelector('input').value.trim(),
          });
      }
      modal.remove();
    },
    { once: true },
  );
}

root.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  if (target.dataset.command) {
    const args = {};
    if (target.dataset.id) args.id = target.dataset.id;
    if (target.dataset.key) {
      args.key = target.dataset.key;
      args.value = target.dataset.value === 'true';
    }
    window.bloom.command(target.dataset.command, args);
  }
  if (target.dataset.ui)
    window.bloom.ui(target.dataset.ui, {
      ...(target.dataset.id ? { id: target.dataset.id } : {}),
      ...(target.dataset.key ? { key: target.dataset.key } : {}),
      ...(target.dataset.view ? { view: target.dataset.view } : {}),
    });
  if (target.dataset.chooser) {
    chooser.toggle(target.dataset.chooser);
    render(true);
  }
  if (target.dataset.pick) {
    window.bloom.command('setSource', {
      key: target.dataset.pick,
      value: target.dataset.id,
    });
    chooser.close();
    render(true);
  }
  if (target.dataset.record) go(`detail/${target.dataset.record}`);
  if (target.dataset.view && !target.dataset.ui) go(target.dataset.view);
  if (target.dataset.seek !== undefined) seek(Number(target.dataset.seek));
  if (target.dataset.dialog) dialog(target.dataset.dialog, target.dataset.id);
  if (target.dataset.copyTranscript) {
    try {
      await navigator.clipboard.writeText(
        state.recordings.find((r) => r.id === target.dataset.copyTranscript)
          ?.transcript || '',
      );
    } catch {
      window.bloom.ui('copy-transcript', { id: target.dataset.copyTranscript });
    }
  }
});
root.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.dataset.form === 'sign-in') {
    const input = event.target.elements.key;
    window.bloom.command('signIn', { key: input.value });
    input.value = '';
  }
  if (event.target.dataset.form === 'mark') {
    const note = event.target.elements.note;
    window.bloom.command('mark', { text: note.value });
    note.value = ''; // the note became a mark
  }
});
root.addEventListener('change', (event) => {
  const el = event.target;
  if (el.dataset.list) {
    list[el.dataset.list] = el.value;
    render(true);
  }
  if (el.dataset.source)
    window.bloom.command('setSource', {
      key: el.dataset.source,
      value: el.type === 'checkbox' ? el.checked : el.value,
    });
  if (el.dataset.pref)
    window.bloom.ui('set-pref', {
      key: el.dataset.pref,
      value:
        el.type === 'checkbox'
          ? el.checked
          : el.dataset.pref === 'nudgeMinutes'
            ? Number(el.value)
            : el.value,
    });
});
root.addEventListener('input', (event) => {
  if (event.target.hasAttribute('data-query')) {
    list.query = event.target.value;
    render(true);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    chooser.close();
    render(true);
  }
  if ((event.metaKey || event.ctrlKey) && event.key === ',') {
    event.preventDefault();
    window.bloom.ui('open-preferences');
  }
});
window.bloom.onView(go);
const receive = (next) => {
  if (!next) return;
  if (firstRun) return firstRun.receive(next);
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
if (surface !== 'onboarding')
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
