// A persistent recording browser and one editing workspace. Capture ticks never rebuild the workspace.
const view = $('#view');
let latest = null,
  current = 'review',
  activeId = null,
  query = '',
  filter = 'all',
  order = 'newest',
  detailTab = 'transcript';
let playerTime = 0,
  playing = false,
  playTimer = null;
const drafts = new Map();
const recordFor = (id) => latest?.recordings.find((r) => r.id === id);
const dateLabel = (r) =>
  new Date(r.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
const passesFilter = (r) =>
  filter === 'all' || (filter === 'edited' && r.draft) || filter === r.status;
// A ready recording needs no label. Only say something when there is something to know.
const statusLabel = (r) =>
  ({
    ready: r.draft ? 'Edited' : '',
    processing: 'Processing',
    error: 'Needs attention',
  })[r.status] || '';
function stopPlayer() {
  clearInterval(playTimer);
  playTimer = null;
  playing = false;
}
function matchingMoments() {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return terms.length
    ? latest.moments.filter(
        (m) =>
          recordFor(m.rec) &&
          passesFilter(recordFor(m.rec)) &&
          terms.every((t) => `${m.words} ${m.text}`.toLowerCase().includes(t)),
      )
    : [];
}
function library() {
  const focusedRecording = document.activeElement?.matches('.record-row')
    ? document.activeElement.dataset.detail
    : null;
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean),
    moments = matchingMoments();
  const rows = latest.recordings.filter(
    (r) =>
      passesFilter(r) &&
      terms.every(
        (t) =>
          `${r.title} ${r.transcript}`.toLowerCase().includes(t) ||
          moments.some((m) => m.rec === r.id),
      ),
  );
  rows.sort((a, b) =>
    order === 'name'
      ? a.title.localeCompare(b.title)
      : order === 'duration'
        ? b.duration - a.duration
        : order === 'oldest'
          ? a.createdAt - b.createdAt
          : b.createdAt - a.createdAt,
  );
  $('#record-count').textContent = latest.recordings.length;
  const list = $('#recording-list'),
    scroll = list.scrollTop;
  list.innerHTML = `${rows.map((r) => `<button class="record-row ${r.id === activeId ? 'selected' : ''}" data-detail="${r.id}" aria-current="${r.id === activeId}" title="${esc(r.title)}"><span class="shot ${r.id === 'r1' ? 'modal' : ''}"></span><span class="record-copy"><b>${esc(r.title)}</b><small>${dateLabel(r)} · ${short(r.duration)}${statusLabel(r) ? ` · <span class="record-status ${r.status}">${r.status === 'error' ? icon('warning') : r.status === 'processing' ? mark('busy') : ''}${statusLabel(r)}</span>` : ''}</small></span></button>`).join('') || `<div class="browser-empty"><b>${latest.recordings.length ? 'No matches' : 'No recordings yet'}</b><p>${latest.recordings.length ? 'Try another search or filter.' : 'Start a recording from the tray.'}</p>${latest.recordings.length ? '<button class="btn" id="clear">Clear filters</button>' : '<button class="btn" data-ui="show-panel">New recording</button>'}</div>`}
    ${moments.length ? `<section class="search-moments"><div class="section-heading"><h2>Matching moments</h2><span class="soft">${moments.length}</span></div>${moments.map((m) => `<button class="moment-result" data-detail="${m.rec}" data-at="${m.at}"><span class="ts">${m.at}</span><span>${esc(m.text)}<small>${esc(recordFor(m.rec).title)}</small></span></button>`).join('')}<button class="btn" id="build-cut">Build a cut from results</button></section>` : ''}`;
  list.scrollTop = scroll;
  if (focusedRecording)
    ($(`.record-row[data-detail="${focusedRecording}"]`) || $('#q'))?.focus({
      preventScroll: true,
    });
}
function workspace() {
  const r = recordFor(activeId);
  if (!r) {
    view.innerHTML =
      '<div class="workspace-empty"><h2>Your workspace is ready</h2><p>Select a recording or start a new one from the tray.</p><button class="btn pri" data-ui="show-panel">New recording</button></div>';
    return;
  }
  const editing = current === 'editor',
    d = draftFor(r),
    v = d.value;
  const oldScroll = $('.transcript-pane')?.scrollTop || 0;
  view.innerHTML = `<div class="workspace">
    <header class="workspace-toolbar"><div class="record-title"><h1 title="${esc(r.title)}">${esc(r.title)}</h1><span>${dateLabel(r)} · ${short(r.duration)} <span id="save-state" role="status">· ${d.saved ? 'Saved for this session' : 'Original'}</span></span></div><div class="seg" role="group" aria-label="Recording mode"><button data-mode="editor" aria-pressed="${editing}" class="${editing ? 'on' : ''}" ${r.status !== 'ready' ? 'disabled' : ''}>Edit</button><button data-mode="review" aria-pressed="${!editing}" class="${!editing ? 'on' : ''}">Review</button></div><button class="btn" data-action="share" data-id="${r.id}">Share</button><details class="record-menu"><summary aria-label="Recording actions" title="Recording actions">•••</summary><div><button data-action="rename" data-id="${r.id}">Rename</button><button data-action="download" data-id="${r.id}">Export…</button><button data-action="copy-transcript" data-id="${r.id}">Copy transcript</button><button data-action="delete" data-id="${r.id}" class="destructive">Delete…</button></div></details></header>
    ${r.status !== 'ready' ? `<div class="processing-banner" role="status"><div><b>${r.status === 'error' ? 'Processing needs attention' : 'Preparing your recording'}</b><p>${r.status === 'error' ? 'Your sample is retained. Retry to prepare the transcript and editor.' : 'Transcript and editing will be available shortly.'}</p></div>${r.status === 'error' ? `<button class="btn" data-cmd="retryRecording" data-id="${r.id}">Retry processing</button>` : ''}</div>` : ''}
    <div class="workspace-columns">${editorPane(r, d, editing)}${sidePane(r)}</div>${editing && detailTab === 'transcript' && r.status === 'ready' ? timeline(r, v) : ''}</div>`;
  $('.transcript-pane').scrollTop = oldScroll;
  paintPlayer();
  placeSelectionCut(); // a rebuilt transcript has no selection, so the cut button must not linger
}
// Editing is the point of this window. The transcript is the wide primary column, the player sits
// beside it, and in Edit mode a timeline runs under both so every cut can be seen at a glance.
const editedLength = (r, v) =>
  Math.max(
    0,
    r.duration -
      v.trim -
      (v.cuts.sil ? r.silence : 0) -
      (v.cuts.fil ? r.filler : 0),
  );
function editBar(r, d) {
  const v = d.value,
    length = editedLength(r, v),
    saved = r.duration - length;
  const suggestions = [
    ['sil', `Silences −${r.silence}s`],
    ['fil', `Filler −${r.filler}s`],
    ['chap', 'Chapters'],
    ['cap', 'Captions'],
  ];
  return `<div class="edit-bar">
    <div class="edit-length" role="status" aria-label="Length after edits"><span>${short(r.duration)}</span><i aria-hidden="true">→</i><b>${short(length)}</b>${saved > 0 ? `<em>−${saved} s</em>` : ''}</div>
    <div class="sugs" role="group" aria-label="Suggested edits">${suggestions.map(([key, label]) => `<button class="sug ${v.cuts[key] ? 'on' : ''}" data-cut="${key}" aria-pressed="${v.cuts[key]}">${label}</button>`).join('')}</div>
    <div class="edit-actions"><button class="btn sm" id="undo-cut" ${!d.past.length ? 'disabled' : ''}>Undo</button><button class="btn sm" id="redo-cut" ${!d.future.length ? 'disabled' : ''}>Redo</button><button class="btn sm" id="cut-selection">Cut selection</button></div>
  </div>`;
}
function editorPane(r, d, editing) {
  const v = d.value,
    ready = r.status === 'ready',
    onTranscript = detailTab === 'transcript';
  const body =
    detailTab === 'versions'
      ? versionList(r)
      : !ready
        ? '<div class="browser-empty">Transcript available when processing finishes.</div>'
        : `${editing ? '' : '<p class="caption">Read-only view of the original. Switch to Edit to cut words and prepare a version.</p>'}<p id="transcript" tabindex="0" aria-label="${editing ? 'Editable sample transcript' : 'Recording transcript'}">${esc(editing ? v.text : r.transcript)}</p>${editing ? '<div class="transcript-foot">Select words to cut them. ⌘Z undoes your last edit.</div>' : ''}`;
  return `<section class="transcript-pane ${editing ? 'editing' : ''}" aria-label="${editing ? 'Editor' : 'Transcript'}">
    <div class="note-tabs" role="group" aria-label="Recording content"><button data-tab="transcript" aria-pressed="${onTranscript}">Transcript</button><button data-tab="versions" aria-pressed="${!onTranscript}">Versions <span>${(r.versions || []).length}</span></button></div>
    ${editing && ready && onTranscript ? editBar(r, d) : ''}
    ${body}
    ${editing && ready && onTranscript ? `<div class="edit-request"><span class="edit-request-mark" aria-hidden="true">${mark('brand')}</span><input id="edit-request" class="field" aria-label="Ask Bloom to edit" placeholder="Ask Bloom to edit: “make a 30-second version”" maxlength="500"><button class="icon-button" id="send-edit-request" aria-label="Review edit request" title="Review edit request">↑</button></div>` : ''}
  </section>`;
}
function sidePane(r) {
  return `<aside class="preview-pane" aria-label="Preview and marks">${player(r)}
    <div class="section-heading"><h2>Marked moments</h2><span class="soft">${r.marks.length} marks</span></div>
    <div class="mark-list">${r.marks.map((m) => `<button class="moment-result" data-seek="${m.at}"><span class="ts">${clock(m.at)}</span><span>${esc(m.text || 'Marked moment')}</span>${icon('play')}</button>`).join('') || '<p class="caption">No marks yet. Press ⇧⌘M during recording to save a moment.</p>'}</div>
    <div class="source-note">${icon('screen')} Sample screen recording <span>Original preserved</span></div>
  </aside>`;
}
function timeline(r, v) {
  return `<section class="timeline" aria-label="Cut overview">
    <div class="timeline-head"><h2>Timeline</h2><span class="caption">Estimates from sample suggestions. Text cuts don’t change video in this preview.</span>
      <span class="timeline-actions">${r.trim ? `<label class="trim-choice"><input type="checkbox" id="trim-ending" ${v.trim ? 'checked' : ''}> Trim quiet ending · ${short(r.trim)}</label>` : ''}<button class="btn sm pri" id="save-version">Save a version</button></span></div>
    <div class="cut-readout"><span>Video</span><div class="cut-track ${v.cuts.sil ? 'with-cuts' : ''}"></div><span>Captions</span><div class="cut-track ${v.cuts.cap ? 'caption-track' : ''}"></div><span>Chapters</span><div class="cut-track ${v.cuts.chap ? 'chapter-track' : ''}"></div></div>
  </section>`;
}

// A cut button appears on the selection itself, so an edit starts where the eyes already are.
const selectionCut = document.createElement('button');
selectionCut.id = 'cut-here';
selectionCut.className = 'sel-pop';
selectionCut.type = 'button';
selectionCut.hidden = true;
selectionCut.textContent = 'Cut';
document.body.append(selectionCut);
function placeSelectionCut() {
  const el = $('#transcript'),
    s = getSelection();
  const active =
    current === 'editor' &&
    el &&
    s.rangeCount &&
    !s.isCollapsed &&
    el.contains(s.anchorNode) &&
    el.contains(s.focusNode);
  selectionCut.hidden = !active;
  $('#cut-selection')?.classList.toggle('pri', !!active);
  if (!active) return;
  const box = s.getRangeAt(0).getBoundingClientRect();
  selectionCut.style.left = `${Math.max(8, Math.min(innerWidth - 64, box.left + box.width / 2 - 26))}px`;
  selectionCut.style.top = `${Math.max(56, box.top - 36)}px`;
}
document.addEventListener('selectionchange', placeSelectionCut);
document.addEventListener(
  'scroll',
  () => {
    selectionCut.hidden = true;
  },
  true,
);
function versionList(r) {
  const items = r.versions || [];
  return `<div class="section-heading"><h2>Outputs &amp; edits</h2><button class="btn sm" id="create-version" ${r.status !== 'ready' ? 'disabled' : ''}>Create version</button></div><p class="caption">Snapshots and output recipes. Kept for this app session.</p><div class="version-row"><div><b>Original recording</b><small>${short(r.duration)} · unchanged source</small></div><button class="btn sm" data-version="original">Review</button></div>${items.map((item, i) => `<div class="version-row"><div><b>${esc(item.name)}</b><small>${item.kind} · ${item.time}</small></div><div class="version-actions"><button class="btn sm" ${item.recipe ? `data-recipe="${i}"` : `data-version="${i}"`}>${item.recipe ? 'Details' : 'Open'}</button><details class="record-menu"><summary aria-label="Manage ${esc(item.name)}">•••</summary><div><button data-version-action="rename" data-version-id="${item.id}">Rename</button><button class="destructive" data-version-action="delete" data-version-id="${item.id}">Delete…</button></div></details></div></div>${item.sources?.length ? `<details class="version-sources"><summary>${item.sources.length} source moments</summary>${item.sources.map((source) => (recordFor(source.recordingId) ? `<button class="moment-result" data-detail="${source.recordingId}" data-at="${clock(source.at)}"><span class="ts">${clock(source.at)}</span><span>${esc(recordFor(source.recordingId).title)}</span>${icon('open-external')}</button>` : `<p class="caption">Source removed · ${clock(source.at)}</p>`)).join('')}</details>` : ''}`).join('')}${!items.length ? '<div class="browser-empty">Save an edit as a version, or build a cut from search results.</div>' : ''}`;
}
function screenIllustration(r) {
  const members = `<div class="demo-heading"><b>Team members</b><span>12 / 12 seats</span></div><div class="demo-table">${['Alex Morgan', 'Priya Sharma', 'Sam Rivera'].map((name, i) => `<div><i>${name[0]}</i><span>${name}<small>${i ? 'Member' : 'Workspace owner'}</small></span><em>${i ? 'Active' : 'Admin'}</em></div>`).join('')}</div><div class="demo-callout">Invite your team<span>Manage access to your workspace</span></div>`;
  const billing =
    '<div class="demo-heading"><b>Billing &amp; plans</b><span>Monthly</span></div><div class="demo-plan"><small>YOUR WORKSPACE</small><strong>Team plan</strong><span>12 seats · monthly billing</span><div class="demo-progress"><i></i></div><small>All seats are in use</small></div><div class="demo-callout">Next invoice<span>Review your plan and usage</span></div>';
  const onboarding =
    '<div class="demo-heading"><b>Welcome to your workspace</b></div><div class="demo-steps"><div><i>✓</i>Create a workspace</div><div><i>2</i>Invite your team</div><div><i>3</i>Share your first project</div></div>';
  return `<div class="demo-app" aria-hidden="true"><div class="demo-nav"><i></i><span></span><span></span><span class="active"></span><span></span></div><div class="demo-content">${r.id === 'r1' ? members : r.id === 'r2' ? billing : onboarding}</div></div>`;
}
function player(r) {
  return `<section class="sample-player" aria-label="Sample playback"><div class="sample-stage"><div class="sample-screen"><span class="sample-screen-label">${esc(r.title)}</span>${screenIllustration(r)}</div><span class="player-preview-label">Illustrated preview · no recorded video</span></div><div class="player-caption"><b id="scene-label"></b><span id="scene-caption"></span></div><div class="player-controls"><button class="btn sm" id="play" aria-label="Play sample preview">${icon('play')} Play</button><span class="mono" id="play-time">${clock(playerTime)}</span><input id="seek" aria-label="Seek sample preview" type="range" min="0" max="${r.duration}" value="${playerTime}" step="1"><span class="mono">${clock(r.duration)}</span></div></section>`;
}
function draftFor(r) {
  if (!drafts.has(r.id)) {
    const p = latest.prefs;
    drafts.set(r.id, {
      value: r.draft
        ? structuredClone(r.draft)
        : {
            text: r.transcript,
            cuts: {
              sil: p.autoSilences,
              fil: p.autoFiller,
              chap: p.autoChapters,
              cap: p.autoCaptions,
            },
            trim: r.trim || 0,
          },
      past: [],
      future: [],
      saved: !!r.draft,
      initialized: current === 'editor',
    });
  }
  const draft = drafts.get(r.id);
  if (
    current === 'editor' &&
    !draft.initialized &&
    !r.draft &&
    !draft.past.length
  ) {
    const p = latest.prefs;
    draft.value.cuts = {
      sil: p.autoSilences,
      fil: p.autoFiller,
      chap: p.autoChapters,
      cap: p.autoCaptions,
    };
    draft.initialized = true;
  }
  return draft;
}
function changeDraft(update) {
  const d = drafts.get(activeId);
  d.past.push(structuredClone(d.value));
  d.future = [];
  update(d.value);
  d.saved = false;
  saveDraft();
}
function saveDraft() {
  const d = drafts.get(activeId);
  if (!d) return;
  window.bloom.command('saveDraft', { id: activeId, draft: d.value });
  const el = $('#save-state');
  if (el) el.textContent = 'Saving…';
}
function paintPlayer() {
  const r = recordFor(activeId);
  if (!r || !$('#seek')) return;
  $('#seek').value = playerTime;
  $('#play-time').textContent = clock(playerTime);
  $('#play').innerHTML =
    `${icon(playing ? 'pause' : 'play')} ${playing ? 'Pause' : 'Play'}`;
  $('#play').setAttribute(
    'aria-label',
    `${playing ? 'Pause' : 'Play'} sample preview`,
  );
  const sentences = r.transcript.match(/[^.!?]+[.!?]*/g) || [r.transcript],
    index = Math.min(
      sentences.length - 1,
      Math.floor((playerTime / Math.max(1, r.duration)) * sentences.length),
    );
  $('#scene-label').textContent =
    r.marks.filter((m) => m.at <= playerTime).at(-1)?.text ||
    'Recording preview';
  $('#scene-caption').textContent = sentences[index];
  $('#scene-caption').hidden =
    current === 'editor' && !drafts.get(activeId).value.cuts.cap;
}
function togglePlayback() {
  if (playing) {
    stopPlayer();
    paintPlayer();
    return;
  }
  const r = recordFor(activeId);
  if (!r) return;
  if (playerTime >= r.duration) playerTime = 0;
  playing = true;
  playTimer = setInterval(() => {
    playerTime = Math.min(playerTime + 1, r.duration);
    if (playerTime >= r.duration) stopPlayer();
    paintPlayer();
  }, 1000);
  paintPlayer();
}
function dialog(action, id) {
  const r = recordFor(id);
  if (!r) return;
  $('#action-dialog')?.remove();
  const modal = document.createElement('dialog');
  modal.id = 'action-dialog';
  modal.setAttribute('aria-labelledby', 'dialog-title');
  const heading = {
    rename: 'Rename recording',
    delete: 'Delete this recording?',
    share: 'Share recording',
    download: 'Export recording',
  }[action];
  modal.innerHTML = `<form method="dialog"><h2 id="dialog-title">${heading}</h2>${action === 'rename' ? `<label>Recording name<input class="field" id="rename-title" value="${esc(r.title)}" maxlength="180" required></label>` : action === 'delete' ? `<p>Remove “${esc(r.title)}” from this sample workspace? You can undo immediately afterwards.</p>` : `<p>${action === 'share' ? 'Sharing links are not connected in this preview. Nothing has been published.' : 'Video export is not connected in this preview. You can copy the recording transcript.'}</p>${action === 'share' ? '<div class="connection-options"><label>Link access<select disabled><option>Private · only you</option></select></label><button type="button" class="btn" disabled>Create sharing link</button></div>' : '<div class="connection-options"><label>Format<select disabled><option>MP4 video</option></select></label><button type="button" class="btn" disabled>Export video</button></div>'}<button type="button" class="btn" data-action="copy-transcript" data-id="${id}">Copy transcript</button>`}<div class="dialog-actions"><button class="btn" value="cancel" formnovalidate>${['share', 'download'].includes(action) ? 'Done' : 'Cancel'}</button>${['rename', 'delete'].includes(action) ? `<button class="btn ${action === 'delete' ? 'danger' : 'pri'}" value="confirm">${action === 'delete' ? 'Delete recording' : 'Save name'}</button>` : ''}</div></form>`;
  document.body.append(modal);
  modal.addEventListener('close', () => {
    if (modal.returnValue === 'confirm') {
      if (action === 'rename') {
        const text = $('#rename-title', modal).value.trim();
        if (text) window.bloom.command('renameRecording', { id, text });
      } else {
        window.bloom.command('deleteRecording', { id });
        go('library');
        showUndoDelete();
      }
    }
    modal.remove();
  });
  modal.showModal();
  if (action === 'rename') $('#rename-title').select();
}
function showUndoDelete() {
  $('#undo-delete')?.remove();
  const el = document.createElement('div');
  el.id = 'undo-delete';
  el.className = 'undo-banner';
  el.setAttribute('role', 'status');
  el.innerHTML =
    'Recording deleted <button class="link" data-cmd="restoreRecording">Undo</button><button class="link" aria-label="Dismiss" id="dismiss-undo">×</button>';
  document.body.append(el);
}
function badge(s) {
  const el = $('#badge');
  const html =
    {
      recording: `<span class="badge rec">${mark('rec')}<b class="mono">${clock(s.elapsed)}</b> · <button data-cmd="${s.ask ? 'answerAsk' : 'stop'}" data-stop="true">${s.ask ? 'Meeting ended? Stop' : 'Stop'}</button></span>`,
      paused: `<span class="badge warn">${icon('pause')} Paused · <button data-cmd="resume">Resume</button></span>`,
      stopped: `<span class="badge warn">${icon('warning')} Recording stopped · <button data-ui="show-panel">Review</button></span>`,
      'processing-error': `<span class="badge warn">Processing failed · <button data-ui="show-panel">Retry</button></span>`,
      saving: `<span class="badge">${mark('busy')} Saving ${short(s.elapsed)}</span>`,
      starting: `<span class="badge">${mark('busy')} Starting</span>`,
    }[s.phase] || '';
  const key = s.phase + (s.ask || '');
  if (el.dataset.key !== key) {
    el.innerHTML = html;
    el.dataset.key = key;
  } else {
    const t = $('b.mono', el);
    if (t) t.textContent = clock(s.elapsed);
  }
}

function go(name) {
  if (!latest) return;
  if (name === 'settings') {
    stopPlayer();
    current = 'settings';
    settings();
    return;
  }
  const [, id] = name.split('/');
  const nextId =
    recordFor(id)?.id ||
    recordFor(activeId)?.id ||
    latest.recordings.find((r) => r.status === 'ready')?.id ||
    latest.recordings[0]?.id;
  if (activeId !== nextId) {
    stopPlayer();
    playerTime = 0;
    detailTab = 'transcript';
  }
  activeId = nextId;
  // A ready recording opens ready to cut. Review is the read-only view of the original.
  current =
    !name.startsWith('review/') && recordFor(activeId)?.status === 'ready'
      ? 'editor'
      : 'review';
  library();
  workspace();
}
function history(direction) {
  const d = drafts.get(activeId);
  if (!d) return;
  const from = direction === 'undo' ? d.past : d.future,
    to = direction === 'undo' ? d.future : d.past;
  if (!from.length) return;
  to.push(structuredClone(d.value));
  d.value = from.pop();
  d.saved = false;
  saveDraft();
  workspace();
}
function saveVersion(fromSearch = false) {
  const r = recordFor(activeId);
  if (!r) return;
  const moments = matchingMoments().filter(
    (m) => recordFor(m.rec)?.status === 'ready',
  );
  const modal = document.createElement('dialog');
  modal.setAttribute('aria-labelledby', 'version-title');
  modal.innerHTML = `<form method="dialog"><h2 id="version-title">${fromSearch ? 'Build a cut' : 'Save a version'}</h2><p>${fromSearch ? 'Choose matching moments for a sample cut. Video assembly will be available when connected.' : 'Keep a named snapshot of your current edit. The original stays unchanged.'}</p><label>Version name<input id="version-name" class="field" maxlength="100" required value="${esc(fromSearch ? `${query.trim()} · highlights` : `Cut ${(r.versions || []).length + 1}`)}"></label>${fromSearch ? `<div class="cut-moments">${moments.map((m, i) => `<div class="cut-moment"><label><input type="checkbox" name="moment" value="${i}" checked><span><b>${m.at}</b> ${esc(m.text)}<small>${esc(recordFor(m.rec).title)}</small></span></label><div><button type="button" class="icon-button" data-move-moment="up" aria-label="Move moment up">↑</button><button type="button" class="icon-button" data-move-moment="down" aria-label="Move moment down">↓</button></div></div>`).join('')}</div>` : ''}<div class="dialog-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn pri" value="confirm" ${fromSearch && !moments.length ? 'disabled' : ''}>${fromSearch ? 'Create sample cut' : 'Save version'}</button></div></form>`;
  document.body.append(modal);
  modal.showModal();
  $('#version-name', modal).select();
  modal.addEventListener('click', (event) => {
    const button = event.target.closest('[data-move-moment]');
    if (!button) return;
    const row = button.closest('.cut-moment'),
      parent = row.parentNode;
    if (button.dataset.moveMoment === 'up' && row.previousElementSibling)
      parent.insertBefore(row, row.previousElementSibling);
    if (button.dataset.moveMoment === 'down' && row.nextElementSibling)
      parent.insertBefore(row.nextElementSibling, row);
    button.focus();
  });
  modal.addEventListener('submit', (event) => {
    if (
      event.submitter?.value === 'confirm' &&
      (!$('#version-name', modal).value.trim() ||
        (fromSearch && !$$('input[name=moment]:checked', modal).length))
    ) {
      event.preventDefault();
      toast('Add a name and select at least one moment.');
    }
  });
  modal.addEventListener('close', () => {
    if (modal.returnValue === 'confirm') {
      const value = structuredClone(draftFor(r).value);
      if (fromSearch)
        value.text = $$('input[name=moment]:checked', modal)
          .map((el) => {
            const m = moments[Number(el.value)];
            return `${recordFor(m.rec).title} · ${m.at}\n${m.text}`;
          })
          .join('\n\n');
      window.bloom.command('saveVersion', {
        id: r.id,
        version: {
          name: $('#version-name', modal).value.trim(),
          value,
          kind: fromSearch ? 'Search cut' : 'Edit snapshot',
          ...(fromSearch
            ? {
                sources: $$('input[name=moment]:checked', modal).map((el) => {
                  const m = moments[Number(el.value)],
                    [minutes, seconds] = m.at.split(':').map(Number);
                  return {
                    recordingId: m.rec,
                    at: minutes * 60 + seconds,
                    text: m.text,
                  };
                }),
              }
            : {}),
        },
      });
      detailTab = 'versions';
      current = 'review';
      workspace();
    }
    modal.remove();
  });
}
document.addEventListener('pointerdown', (event) => {
  if (event.target.closest('#cut-selection, #cut-here')) event.preventDefault();
});
document.addEventListener('click', async (event) => {
  const t = event.target.closest('button,input');
  if (!t) return;
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.view && !t.dataset.ui) return go(t.dataset.view);
  if (t.dataset.detail) {
    go(`detail/${t.dataset.detail}`);
    const selected = $(`.record-row[data-detail="${t.dataset.detail}"]`);
    selected?.focus({ preventScroll: true });
    if (t.dataset.at) {
      const [m, s] = t.dataset.at.split(':').map(Number);
      playerTime = m * 60 + s;
      paintPlayer();
    }
    return;
  }
  if (t.dataset.mode) {
    current = t.dataset.mode;
    detailTab = 'transcript';
    workspace();
    $(`[data-mode="${current}"]`)?.focus();
    return;
  }
  if (t.dataset.tab) {
    detailTab = t.dataset.tab;
    workspace();
    $(`[data-tab="${detailTab}"]`)?.focus();
    return;
  }
  if (t.dataset.seek !== undefined) {
    playerTime = Number(t.dataset.seek);
    paintPlayer();
    return;
  }
  if (t.dataset.action) {
    $('.record-menu')?.removeAttribute('open');
    if (t.dataset.action === 'copy-transcript') {
      try {
        await navigator.clipboard.writeText(
          current === 'editor'
            ? draftFor(recordFor(activeId)).value.text
            : recordFor(t.dataset.id).transcript,
        );
        toast('Transcript copied');
      } catch {
        toast('Could not copy. Select and copy the transcript instead.');
      }
    } else dialog(t.dataset.action, t.dataset.id);
    return;
  }
  if (t.dataset.cut) {
    changeDraft((v) => {
      v.cuts[t.dataset.cut] = !v.cuts[t.dataset.cut];
    });
    workspace();
    $(`[data-cut="${t.dataset.cut}"]`)?.focus();
    return;
  }
  if (t.dataset.version !== undefined) {
    if (t.dataset.version === 'original') {
      current = 'review';
      detailTab = 'transcript';
      workspace();
    } else {
      const item = recordFor(activeId)?.versions?.[Number(t.dataset.version)];
      if (item) {
        changeDraft((v) => Object.assign(v, structuredClone(item.value)));
        current = 'editor';
        detailTab = 'transcript';
        workspace();
      }
    }
    return;
  }
  if (t.id === 'cut-selection' || t.id === 'cut-here') {
    const selection = window.getSelection(),
      el = $('#transcript');
    if (
      !selection.rangeCount ||
      selection.isCollapsed ||
      !el.contains(selection.anchorNode) ||
      !el.contains(selection.focusNode)
    )
      return toast('Select transcript words first');
    const range = selection.getRangeAt(0),
      before = range.cloneRange();
    before.selectNodeContents(el);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length,
      count = range.toString().length;
    changeDraft((v) => {
      v.text = v.text.slice(0, start) + v.text.slice(start + count);
    });
    workspace();
    $('#cut-selection').focus();
    return;
  }
  if (t.id === 'undo-cut') {
    history('undo');
    ($('#undo-cut:not(:disabled)') || $('#redo-cut'))?.focus();
  }
  if (t.id === 'redo-cut') {
    history('redo');
    ($('#redo-cut:not(:disabled)') || $('#undo-cut'))?.focus();
  }
  if (t.id === 'trim-ending') {
    changeDraft((v) => {
      v.trim = t.checked ? recordFor(activeId).trim : 0;
    });
    workspace();
  }
  if (t.id === 'play') togglePlayback();
  if (t.id === 'clear') {
    query = '';
    filter = 'all';
    $('#q').value = '';
    $('#filter').value = 'all';
    library();
    $('#q').focus();
  }
  if (t.id === 'dismiss-undo' || t.dataset.cmd === 'restoreRecording')
    $('#undo-delete')?.remove();
  if (t.id === 'save-version') saveVersion();
  if (t.id === 'build-cut') saveVersion(true);
  if (t.id === 'toggle-browser') {
    const hidden = document
      .querySelector('.app')
      .classList.toggle('browser-hidden');
    t.setAttribute('aria-expanded', !hidden);
    t.setAttribute('aria-label', `${hidden ? 'Show' : 'Hide'} recordings`);
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'q') {
    query = event.target.value;
    library();
  }
  if (event.target.id === 'seek') {
    playerTime = Number(event.target.value);
    paintPlayer();
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'sort') {
    order = event.target.value;
    library();
  }
  if (event.target.id === 'filter') {
    filter = event.target.value;
    library();
  }
});
document.addEventListener('keydown', (event) => {
  if (
    current === 'editor' &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === 'z' &&
    !event.target.matches('input,textarea')
  ) {
    event.preventDefault();
    history(event.shiftKey ? 'redo' : 'undo');
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
    event.preventDefault();
    document.querySelector('.app').classList.remove('browser-hidden');
    $('#toggle-browser').setAttribute('aria-expanded', 'true');
    $('#toggle-browser').setAttribute('aria-label', 'Hide recordings');
    $('#q').focus();
  }
  if (event.key === 'Escape')
    $$('.record-menu').forEach((el) => el.removeAttribute('open'));
});
document.addEventListener('click', (event) => {
  $$('.record-menu[open]').forEach((el) => {
    if (!el.contains(event.target)) el.removeAttribute('open');
  });
});
function onState(s) {
  const prefsChanged =
    !latest ||
    latest.prefError !== s.prefError ||
    JSON.stringify(latest.prefs) !== JSON.stringify(s.prefs) ||
    JSON.stringify(latest.permissions) !== JSON.stringify(s.permissions);
  const oldRecord = recordFor(activeId),
    recordsChanged =
      latest &&
      JSON.stringify(latest.recordings) !== JSON.stringify(s.recordings);
  latest = s;
  badge(s);
  if (current === 'settings' && prefsChanged) settings();
  if (recordsChanged) {
    library();
    if (current === 'settings') return;
    const r = recordFor(activeId);
    if (!r) return go('library');
    const d = drafts.get(activeId);
    if (
      d &&
      r.draft &&
      JSON.stringify(r.draft.text) === JSON.stringify(d.value.text) &&
      r.draft.trim === d.value.trim &&
      Object.keys(d.value.cuts).every(
        (k) => r.draft.cuts[k] === d.value.cuts[k],
      )
    ) {
      d.saved = true;
      if ($('#save-state'))
        $('#save-state').textContent = '· Saved for this session';
    }
    if (oldRecord?.title !== r.title) {
      const title = $('.record-title h1');
      if (title) {
        title.textContent = r.title;
        title.title = r.title;
      }
    }
    if (
      oldRecord?.status !== r.status ||
      JSON.stringify(oldRecord?.versions) !== JSON.stringify(r.versions)
    ) {
      workspace();
      if (detailTab === 'versions') $('[data-tab=versions]')?.focus();
    }
  }
}
window.bloom.onView(go);
window.bloom.onState(onState);
window.bloom.getState().then((s) => {
  onState(s);
  library();
  go(decodeURIComponent(location.hash.slice(1)) || 'library');
  window.bloom.ui('main-ready');
});

// A version menu stays within the independently scrolling transcript pane.
document.addEventListener(
  'toggle',
  (event) => {
    const menu = event.target;
    if (!menu.matches?.('.version-actions .record-menu') || !menu.open) return;
    const pane = menu.closest('.transcript-pane'),
      summary = menu.querySelector('summary'),
      content = menu.querySelector('div');
    menu.classList.toggle(
      'menu-below',
      summary.getBoundingClientRect().top - pane.getBoundingClientRect().top <
        content.offsetHeight + 12,
    );
  },
  true,
);
document.addEventListener(
  'scroll',
  () => {
    $$('.record-menu[open]').forEach((el) => el.removeAttribute('open'));
  },
  true,
);
