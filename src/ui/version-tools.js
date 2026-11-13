// Planned VideoDB actions are reviewable recipes; this preview never starts a paid job.
const versionTools = {
  captions: {
    label: 'Captions',
    hint: 'Choose how words appear on screen.',
    options: ['Clean', 'Word highlight', 'Minimal'],
  },
  dub: {
    label: 'Translate & dub',
    hint: 'Choose a language for another voice track.',
    options: ['Hindi', 'Spanish', 'Japanese', 'English'],
  },
  voice: {
    label: 'Clean voice',
    hint: 'Prepare a new voice from the edited script.',
    options: ['Natural', 'Clear & steady', 'Warm'],
  },
  music: {
    label: 'Music bed',
    hint: 'Describe background music to sit under the voice.',
    options: ['Quiet', 'Balanced'],
    placeholder: 'Calm, no vocals, under the narration',
  },
  vertical: {
    label: 'Vertical video',
    hint: 'Frame the recording for a portrait screen.',
    options: ['9:16 portrait', '1:1 square', '4:5 portrait'],
  },
  short: {
    label: 'Short highlight',
    hint: 'Describe the part worth keeping.',
    options: ['15 seconds', '30 seconds', '60 seconds'],
    placeholder: 'Just the problem and the expected result',
  },
};
function recipeDialog(existing = null) {
  const r = recordFor(activeId);
  if (!r) return;
  const modal = document.createElement('dialog');
  modal.className = 'recipe-dialog';
  modal.setAttribute('aria-labelledby', 'recipe-heading');
  const config = existing?.recipe || {
    type: 'captions',
    option: 'Clean',
    prompt: '',
  };
  modal.innerHTML = `<form method="dialog"><h2 id="recipe-heading">${existing ? 'Version recipe' : 'Create a version'}</h2><p>Prepare an output from this edit. Generation and pricing will be available when VideoDB is connected.</p><label>Output<select id="recipe-type">${Object.entries(
    versionTools,
  )
    .map(
      ([key, tool]) =>
        `<option value="${key}" ${key === config.type ? 'selected' : ''}>${tool.label}</option>`,
    )
    .join(
      '',
    )}</select></label><div id="recipe-fields"></div><label>Name<input class="field" id="recipe-name" maxlength="100" required value="${esc(existing?.name || versionTools[config.type].label)}"></label><div class="recipe-cost"><b>Sample recipe · no charge</b><span>No video is generated. In the connected app, you’ll review the estimated cost before starting.</span></div><div class="dialog-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn pri" value="confirm">${existing ? 'Save as new recipe' : 'Save sample recipe'}</button></div></form>`;
  const fields = () => {
    const tool = versionTools[$('#recipe-type', modal).value];
    $('#recipe-fields', modal).innerHTML =
      `<p class="caption">${tool.hint}</p><label>${$('#recipe-type', modal).value === 'dub' ? 'Language' : 'Style / format'}<select id="recipe-option">${tool.options.map((option) => `<option ${option === config.option ? 'selected' : ''}>${option}</option>`).join('')}</select></label>${tool.placeholder ? `<label>Direction<textarea id="recipe-prompt" rows="3" maxlength="500" placeholder="${tool.placeholder}">${esc(config.prompt)}</textarea></label>` : ''}`;
  };
  document.body.append(modal);
  fields();
  modal.showModal();
  $('#recipe-type', modal).addEventListener('change', () => {
    fields();
    $('#recipe-name', modal).value =
      versionTools[$('#recipe-type', modal).value].label;
  });
  modal.addEventListener('submit', (event) => {
    if (
      event.submitter?.value === 'confirm' &&
      !$('#recipe-name', modal).value.trim()
    ) {
      event.preventDefault();
      $('#recipe-name', modal).focus();
    }
  });
  modal.addEventListener('close', () => {
    if (modal.returnValue === 'confirm') {
      window.bloom.command('saveVersion', {
        id: r.id,
        version: {
          name: $('#recipe-name', modal).value.trim(),
          kind: 'Version recipe',
          value: structuredClone(existing?.value || draftFor(r).value),
          recipe: {
            type: $('#recipe-type', modal).value,
            option: $('#recipe-option', modal).value,
            prompt: $('#recipe-prompt', modal)?.value.trim() || '',
          },
        },
      });
      detailTab = 'versions';
      workspace();
    }
    modal.remove();
  });
}
function editRequest() {
  const r = recordFor(activeId),
    input = $('#edit-request'),
    request = input?.value.trim();
  if (!r || !request) return;
  const modal = document.createElement('dialog');
  modal.setAttribute('aria-labelledby', 'request-title');
  modal.innerHTML = `<form method="dialog"><h2 id="request-title">Edit request</h2><p>“${esc(request)}”</p><div class="note">Natural-language editing needs a connected VideoDB account. You can save this direction as a sample short-version recipe, or use the transcript selection tools now.</div><div class="dialog-actions"><button class="btn" value="cancel">Back to editing</button><button class="btn pri" value="recipe">Prepare a recipe</button></div></form>`;
  document.body.append(modal);
  modal.showModal();
  modal.addEventListener('close', () => {
    const chosen = modal.returnValue;
    modal.remove();
    if (chosen === 'recipe')
      recipeDialog({
        name: 'Requested edit',
        recipe: { type: 'short', option: '30 seconds', prompt: request },
      });
  });
}
document.addEventListener('click', (event) => {
  const el = event.target.closest('button');
  if (!el) return;
  if (el.id === 'create-version') recipeDialog();
  if (el.dataset.recipe !== undefined)
    recipeDialog(recordFor(activeId)?.versions?.[Number(el.dataset.recipe)]);
  if (el.id === 'send-edit-request') editRequest();
});
document.addEventListener('keydown', (event) => {
  if (event.target.id === 'edit-request' && event.key === 'Enter') {
    event.preventDefault();
    editRequest();
  }
});

function manageVersion(action, versionId) {
  const recording = recordFor(activeId),
    version = recording?.versions?.find((v) => v.id === versionId);
  if (!version) return;
  const returnFocus = $(`[data-version-id="${versionId}"]`)
    ?.closest('details')
    ?.querySelector('summary');
  $$('.record-menu[open]').forEach((el) => el.removeAttribute('open'));
  const modal = document.createElement('dialog');
  modal.setAttribute('aria-labelledby', 'manage-version-heading');
  modal.innerHTML = `<form method="dialog"><h2 id="manage-version-heading">${action === 'rename' ? 'Rename version' : 'Delete this version?'}</h2>${action === 'rename' ? `<label>Name<input class="field" id="managed-version-name" value="${esc(version.name)}" maxlength="100" required></label>` : `<p>Remove “${esc(version.name)}”? Your original recording and other versions stay intact.</p>`}<div class="dialog-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn ${action === 'delete' ? 'danger' : 'pri'}" value="confirm">${action === 'rename' ? 'Save name' : 'Delete version'}</button></div></form>`;
  document.body.append(modal);
  modal.showModal();
  $('#managed-version-name', modal)?.select();
  modal.addEventListener('submit', (event) => {
    if (
      event.submitter?.value === 'confirm' &&
      action === 'rename' &&
      !$('#managed-version-name', modal).value.trim()
    ) {
      event.preventDefault();
      $('#managed-version-name', modal).focus();
    }
  });
  modal.addEventListener('close', () => {
    if (modal.returnValue === 'confirm')
      window.bloom.command(
        action === 'rename' ? 'renameVersion' : 'deleteVersion',
        {
          id: recording.id,
          versionId,
          ...(action === 'rename'
            ? { text: $('#managed-version-name', modal).value.trim() }
            : {}),
        },
      );
    modal.remove();
    if (modal.returnValue !== 'confirm') returnFocus?.focus();
  });
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-version-action]');
  if (button)
    manageVersion(button.dataset.versionAction, button.dataset.versionId);
});
