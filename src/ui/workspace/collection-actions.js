import { esc } from '../shared/dom.js';

export function bindCollectionActions(root, { state, go }) {
  function menu(target) {
    window.bloom.ui('collection-menu', { id: target.dataset.collection });
  }
  root.addEventListener('contextmenu', (event) => {
    const target = event.target.closest('[data-collection]');
    if (!target) return;
    event.preventDefault();
    menu(target);
  });
  root.addEventListener('keydown', (event) => {
    const target = event.target.closest('[data-collection]');
    if (
      target &&
      (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    ) {
      event.preventDefault();
      menu(target);
    }
  });
  window.bloom.onCollectionAction(({ action, id }) => {
    const collection = state()?.collections.find((c) => c.id === id);
    if (!collection) return;
    if (action === 'open') {
      window.bloom.command('openCollection', { id });
      go('recordings');
    } else if (action === 'reconcile') {
      window.bloom.command('reconcileCollectionAction', { id });
    } else if (
      ['rename', 'delete'].includes(action) &&
      !collection.bloom &&
      !collection.pendingOperation
    ) {
      confirmCollectionAction(action, collection, go);
    }
  });
}

function confirmCollectionAction(action, collection, go) {
  if (document.querySelector('dialog[open]')) return;
  const rename = action === 'rename';
  const modal = document.createElement('dialog');
  modal.setAttribute('aria-labelledby', 'collection-dialog-title');
  modal.innerHTML = `<form method="dialog">
    <h2 id="collection-dialog-title">${rename ? 'Rename collection' : 'Delete collection?'}</h2>
    ${
      rename
        ? `<label>Collection name<input class="field" name="title" maxlength="120" value="${esc(collection.name)}" required /></label>`
        : `<p>Delete “${esc(collection.name)}” and all media in it from VideoDB? This cannot be undone.</p>`
    }
    <div class="dialog-actions">
      <button class="btn" value="cancel" formnovalidate ${rename ? '' : 'autofocus'}>Cancel</button>
      <button class="btn ${rename ? 'pri' : 'danger'}" value="confirm">${rename ? 'Save' : 'Delete collection'}</button>
    </div>
  </form>`;
  modal.querySelector('form').addEventListener('submit', (event) => {
    if (event.submitter?.value !== 'confirm' || !rename) return;
    const input = modal.querySelector('input');
    if (!input.value.trim() || input.value.trim() === 'Bloom Recordings') {
      event.preventDefault();
      input.setCustomValidity('Choose a name other than Bloom Recordings.');
      input.reportValidity();
    }
  });
  modal
    .querySelector('input')
    ?.addEventListener('input', (event) => event.target.setCustomValidity(''));
  document.body.append(modal);
  modal.showModal();
  if (rename) modal.querySelector('input').select();
  modal.addEventListener(
    'close',
    () => {
      if (modal.returnValue === 'confirm') {
        window.bloom.command(rename ? 'renameCollection' : 'deleteCollection', {
          id: collection.id,
          ...(rename
            ? { text: modal.querySelector('input').value.trim() }
            : {}),
        });
        if (!rename) go('recordings');
      }
      modal.remove();
    },
    { once: true },
  );
}
