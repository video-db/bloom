// Every click, form, field and key in the tray panel and the main window, as one delegated
// handler per event: markup names what it does (data-command, data-ui, data-view, …) and
// this file turns that into a command for the engine or a change to what the window shows.
import { chooser } from './panel/sources.js';
import { seek, startAt } from './workspace/player.js';
import { confirmRecordingAction } from './workspace/dialogs.js';

// state: () => latest app state. browse: how Recordings is looked at. go: change view.
// render(force): redraw this window.
export function bindActions(root, { state, browse, go, render }) {
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
    if (target.dataset.pref) {
      const { pref, value } = target.dataset;
      window.bloom.ui('set-pref', {
        key: pref,
        value:
          value === 'true' || value === 'false'
            ? value === 'true'
            : pref === 'nudgeMinutes'
              ? Number(value)
              : value,
      });
    }
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
    if (target.dataset.record) {
      // A search result opens its recording at the moment it found.
      if (target.dataset.at !== undefined)
        startAt(target.dataset.record, Number(target.dataset.at));
      go(`recording/${target.dataset.record}`);
    }
    if (target.dataset.place) {
      // Recordings is Bloom's own collection; leave any other one being browsed.
      if (target.dataset.place === 'recordings')
        window.bloom.command('closeCollection');
      go(target.dataset.place);
    }
    if (target.dataset.collection) {
      window.bloom.command('openCollection', { id: target.dataset.collection });
      go('recordings');
    }
    if (target.dataset.browse) {
      browse[target.dataset.browse] = target.dataset.value;
      render(true);
    }
    if (target.dataset.view && !target.dataset.ui) go(target.dataset.view);
    if (target.dataset.seek !== undefined) seek(Number(target.dataset.seek));
    if (target.dataset.dialog) {
      const record = state().recordings.find((r) => r.id === target.dataset.id);
      if (record) confirmRecordingAction(target.dataset.dialog, record);
    }
    if (target.dataset.copyTranscript) {
      try {
        await navigator.clipboard.writeText(
          state().recordings.find((r) => r.id === target.dataset.copyTranscript)
            ?.transcript || '',
        );
      } catch {
        window.bloom.ui('copy-transcript', {
          id: target.dataset.copyTranscript,
        });
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
    if (event.target.dataset.form === 'search')
      window.bloom.command('search', { text: event.target.elements.q.value });
    if (event.target.dataset.form === 'mark') {
      const note = event.target.elements.note;
      window.bloom.command('mark', { text: note.value });
      note.value = ''; // the note became a mark
    }
  });
  root.addEventListener('change', (event) => {
    const el = event.target;
    if (el.dataset.browse) {
      browse[el.dataset.browse] = el.value;
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
}
