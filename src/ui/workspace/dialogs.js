// Rename and delete ask in a dialog before anything reaches VideoDB.
import { esc } from '../shared/dom.js';

export function confirmRecordingAction(action, record) {
  const id = record.id;
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

// Removing a version: said plainly what goes and what stays, before it goes.
export function confirmRemoveVersion(record, version, done) {
  const modal = document.createElement('dialog');
  modal.innerHTML = /* HTML */ `<form method="dialog">
    <h2>Remove this version from this Mac?</h2>
    <p>
      “${esc(version.name)}” will no longer be listed with
      “${esc(record.title)}”. The original recording is not affected.
    </p>
    <p>
      Its video stays in VideoDB, so a link you already shared keeps working,
      but Bloom will not show it again.
    </p>
    <div class="dialog-actions">
      <button class="btn" value="cancel" formnovalidate>Cancel</button
      ><button class="btn danger" value="confirm">Remove</button>
    </div>
  </form>`;
  document.body.append(modal);
  modal.showModal();
  modal.addEventListener(
    'close',
    () => {
      if (modal.returnValue === 'confirm') {
        done();
        window.bloom.command('removeVersion', {
          id: record.id,
          version: version.id,
        });
      }
      modal.remove();
    },
    { once: true },
  );
}
