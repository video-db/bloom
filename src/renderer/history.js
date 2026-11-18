/**
 * History Window Logic
 */

let hlsInstance = null;
let activeRecordingId = null;
let activeRecording = null;
let activeStreamUrl = null;
let refreshInterval = null;
let currentSort = 'date-newest';
let pendingFocusSessionId = null;

const PAGE_SIZE = 20;
let currentOffset = 0;
let hasMore = false;
let loadedRecordings = []; // all loaded recordings across pages
let currentSearch = null;
let searchDebounceTimer = null;

const STATUS_MAP = {
    recording:  { label: 'Recording',   cls: 'status-recording' },
    pending:    { label: 'Processing',   cls: 'status-processing' },
    processing: { label: 'Processing',   cls: 'status-processing' },
    indexing:   { label: 'Transcribing',   cls: 'status-done' },
    ready:      { label: 'Done',         cls: 'status-done' },
    failed:     { label: 'Error',        cls: 'status-error' },
};

function getStatusInfo(status) {
    return STATUS_MAP[status] || STATUS_MAP.pending;
}

function getDisplayName(recording) {
    if (recording.name) return recording.name;
    if (recording.created_at) {
        const d = new Date(recording.created_at);
        return 'Recording at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    return 'Untitled Recording';
}

function formatTime(recording) {
    if (recording.created_at) {
        return new Date(recording.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    return '';
}

function getDateKey(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function getDateLabel(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const recDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((today - recDay) / 86400000);

    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: now.getFullYear() !== d.getFullYear() ? 'numeric' : undefined });
}

function createDateHeader(label) {
    const div = document.createElement('div');
    div.className = 'date-header';
    div.textContent = label;
    return div;
}

function formatDuration(seconds) {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// --- Init ---

async function init() {
    // Listen for focus-recording events from the main process (e.g. after recording stops)
    window.recorderAPI.onFocusRecording((sessionId) => {
        pendingFocusSessionId = sessionId;
        loadHistoryList();
    });

    loadHistoryList();

    // Recording button — init state and wire up
    initRecordingButton();

    // Auto-sync pending recordings when library opens
    syncPendingRecordings();
    document.getElementById('shareBtn')?.addEventListener('click', handleShare);
    document.getElementById('chatBarBtn')?.addEventListener('click', handleChatWithVideo);
    document.getElementById('editNameBtn')?.addEventListener('click', () => startNameEdit());

    const input = document.getElementById('playerTitleInput');
    if (input) {
        input.addEventListener('blur', () => commitNameEdit());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { cancelNameEdit(); }
        });
    }

    // Download split button
    const downloadChevron = document.getElementById('downloadChevronBtn');
    const downloadMenu = document.getElementById('downloadMenu');
    if (downloadChevron && downloadMenu) {
        downloadChevron.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadMenu.classList.toggle('visible');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.download-split')) {
                downloadMenu.classList.remove('visible');
            }
        });
    }
    document.getElementById('downloadBtn')?.addEventListener('click', () => handleDownloadVideo());
    document.getElementById('undoBtn')?.addEventListener('click', () => undoDelete());
    document.getElementById('downloadVideoBtn')?.addEventListener('click', () => {
        document.getElementById('downloadMenu')?.classList.remove('visible');
        handleDownloadVideo();
    });
    document.getElementById('downloadTranscriptBtn')?.addEventListener('click', () => {
        document.getElementById('downloadMenu')?.classList.remove('visible');
        handleDownloadTranscript();
    });

    // Sort dropdown
    const sortBtn = document.getElementById('sortBtn');
    const sortDropdown = document.getElementById('sortDropdown');
    if (sortBtn && sortDropdown) {
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sortDropdown.classList.toggle('visible');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.sort-dropdown-wrap')) {
                sortDropdown.classList.remove('visible');
            }
        });
        sortDropdown.querySelectorAll('.sort-option:not(.disabled)').forEach(opt => {
            opt.addEventListener('click', () => {
                const sort = opt.dataset.sort;
                if (sort === currentSort) return;
                currentSort = sort;
                // Update radio states
                sortDropdown.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                // Update label
                const labels = { 'date-newest': 'Newest', 'date-oldest': 'Oldest', 'duration-longest': 'Longest', 'duration-shortest': 'Shortest' };
                const sortLabel = document.getElementById('sortLabel');
                if (sortLabel) sortLabel.textContent = labels[sort] || 'Newest';
                // Re-sort list
                applySortToList();
                sortDropdown.classList.remove('visible');
            });
        });
    }

    // Keyboard navigation on video list
    const listContainer = document.getElementById('videoListContainer');
    if (listContainer) {
        listContainer.addEventListener('keydown', (e) => {
            const items = Array.from(listContainer.querySelectorAll('.video-item:not(.deleting-slide)'));
            if (items.length === 0) return;

            const activeEl = listContainer.querySelector('.video-item.active');
            const activeIdx = activeEl ? items.indexOf(activeEl) : -1;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIdx = activeIdx < items.length - 1 ? activeIdx + 1 : 0;
                const rec = loadedRecordings.find(r => r.id === Number(items[nextIdx].dataset.id));
                if (rec) selectRecording(rec);
                items[nextIdx].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIdx = activeIdx > 0 ? activeIdx - 1 : items.length - 1;
                const rec = loadedRecordings.find(r => r.id === Number(items[prevIdx].dataset.id));
                if (rec) selectRecording(rec);
                items[prevIdx].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (activeEl && activeRecordingId) {
                    e.preventDefault();
                    const rec = loadedRecordings.find(r => r.id === activeRecordingId);
                    if (rec) initiateDelete(rec);
                }
            }
        });
    }

    // Search (server-side, debounced)
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            currentSearch = query || null;
            loadHistoryList();
        }, 300);
    });
}

// --- List ---

async function loadHistoryList() {
    const listContainer = document.getElementById('videoListContainer');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="empty-state">Loading...</div>';
    currentOffset = 0;
    loadedRecordings = [];

    try {
        const recordings = await window.recorderAPI.getRecordings(0, currentSearch);
        hasMore = recordings.length === PAGE_SIZE;
        loadedRecordings = recordings;

        if (!recordings || recordings.length === 0) {
            listContainer.innerHTML = currentSearch
                ? '<div class="empty-state">No recordings match your search.</div>'
                : '<div class="empty-state">No recordings yet.</div>';
            scheduleAutoRefresh();
            return;
        }

        sortRecordings(recordings);
        listContainer.innerHTML = '';

        appendRecordingsWithHeaders(listContainer, recordings);

        if (hasMore) appendLoadMoreButton(listContainer);

        // Auto-select: pending focus session > previously active > first
        let toSelect = null;
        if (pendingFocusSessionId) {
            toSelect = recordings.find(r => r.session_id === pendingFocusSessionId);
        }
        if (!toSelect) {
            toSelect = recordings.find(r => r.id === activeRecordingId) || recordings[0];
        }
        if (toSelect) {
            selectRecording(toSelect, false);
            if (pendingFocusSessionId && toSelect.session_id === pendingFocusSessionId) {
                pendingFocusSessionId = null;
                startNameEdit();
            }
        }

        scheduleAutoRefresh();
    } catch (error) {
        listContainer.innerHTML = `<div class="empty-state" style="color:#EF3535">Failed to load: ${error.message}</div>`;
    }
}

async function loadMoreRecordings() {
    const listContainer = document.getElementById('videoListContainer');
    if (!listContainer) return;

    // Remove load-more button while loading
    listContainer.querySelector('.load-more-btn')?.remove();

    const newOffset = currentOffset + PAGE_SIZE;
    const recordings = await window.recorderAPI.getRecordings(newOffset, currentSearch);
    currentOffset = newOffset;
    hasMore = recordings.length === PAGE_SIZE;

    loadedRecordings = loadedRecordings.concat(recordings);
    sortRecordings(recordings);
    appendRecordingsWithHeaders(listContainer, recordings);

    if (hasMore) appendLoadMoreButton(listContainer);
    scheduleAutoRefresh();
}

function appendLoadMoreButton(container) {
    container.querySelector('.load-more-btn')?.remove();
    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = 'Load More';
    btn.addEventListener('click', loadMoreRecordings);
    container.appendChild(btn);
}

function appendRecordingsWithHeaders(container, recordings) {
    const showHeaders = currentSort.startsWith('date');

    let lastDateKey = null;
    if (showHeaders) {
        const existingHeaders = container.querySelectorAll('.date-header');
        if (existingHeaders.length > 0) {
            lastDateKey = existingHeaders[existingHeaders.length - 1].dataset.dateKey;
        }
    }

    for (const rec of recordings) {
        if (showHeaders) {
            const key = getDateKey(rec.created_at);
            if (key !== lastDateKey) {
                container.appendChild(createDateHeader(getDateLabel(rec.created_at)));
                container.lastElementChild.dataset.dateKey = key;
                lastDateKey = key;
            }
        }
        container.appendChild(createVideoListItem(rec));
    }
}

function scheduleAutoRefresh() {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    const inProgressIds = loadedRecordings
        .filter(r => r.insights_status === 'recording' || r.insights_status === 'pending' || r.insights_status === 'processing' || r.insights_status === 'indexing')
        .map(r => r.id);
    if (inProgressIds.length > 0) {
        refreshInterval = setInterval(() => refreshInProgressItems(inProgressIds), 5000);
    }
}

async function refreshInProgressItems(ids) {
    try {
        const updated = await window.recorderAPI.getRecordingsByIds(ids);
        if (!updated || updated.length === 0) return;

        let needsReschedule = false;
        for (const rec of updated) {
            // Update cached data
            const idx = loadedRecordings.findIndex(r => r.id === rec.id);
            if (idx !== -1) loadedRecordings[idx] = rec;

            // Update DOM element in place
            const el = document.querySelector(`.video-item[data-id="${rec.id}"]`);
            if (el) updateVideoListItem(el, rec);

            // Update active player if this is the selected recording
            if (rec.id === activeRecordingId) {
                activeRecording = rec;
                showPlayer(rec);
                updatePlayerHeader(rec);
            }

            const still = rec.insights_status === 'recording' || rec.insights_status === 'pending' || rec.insights_status === 'processing' || rec.insights_status === 'indexing';
            if (still) needsReschedule = true;
        }

        // Stop polling if nothing is in progress anymore
        if (!needsReschedule && refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    } catch (err) {
        console.error('Error refreshing in-progress items:', err);
    }
}

function sortRecordings(recordings) {
    switch (currentSort) {
        case 'date-oldest':
            recordings.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            break;
        case 'duration-longest':
            recordings.sort((a, b) => (b.duration || 0) - (a.duration || 0));
            break;
        case 'duration-shortest':
            recordings.sort((a, b) => (a.duration || 0) - (b.duration || 0));
            break;
        default:
            recordings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
}

function applySortToList() {
    loadHistoryList();
}

function createVideoListItem(recording) {
    const div = document.createElement('div');
    div.className = 'video-item';
    div.dataset.id = recording.id;
    if (recording.id === activeRecordingId) div.classList.add('active');

    const name = getDisplayName(recording);
    const timeStr = formatTime(recording);
    const durationStr = formatDuration(recording.duration);
    const status = getStatusInfo(recording.insights_status);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'video-item-title';
    titleSpan.textContent = name;

    const meta = document.createElement('div');
    meta.className = 'video-item-meta';

    if (timeStr) {
        const timeChip = document.createElement('span');
        timeChip.className = 'meta-chip';
        timeChip.innerHTML = `<span class="material-symbols-rounded meta-icon">schedule</span>${timeStr}`;
        meta.appendChild(timeChip);
    }
    if (durationStr) {
        const durChip = document.createElement('span');
        durChip.className = 'meta-chip';
        durChip.innerHTML = `<span class="material-symbols-rounded meta-icon">timer</span>${durationStr}`;
        meta.appendChild(durChip);
    }

    const details = document.createElement('div');
    details.className = 'video-item-details';
    details.appendChild(titleSpan);
    details.appendChild(meta);

    div.appendChild(details);

    // Delete button (visible on hover via CSS)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'video-item-delete-btn';
    deleteBtn.innerHTML = '<span class="material-symbols-rounded">delete</span>';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = loadedRecordings.find(r => r.id === recording.id) || recording;
        initiateDelete(current);
    });
    div.appendChild(deleteBtn);

    // Only show badge for in-progress or error states
    if (recording.insights_status !== 'ready') {
        const badge = document.createElement('span');
        badge.className = `status-badge ${status.cls}`;
        badge.innerHTML = `<span class="status-icon"><span class="status-dot"></span></span>${status.label}`;
        div.appendChild(badge);
    }

    div.addEventListener('click', () => {
        const current = loadedRecordings.find(r => r.id === recording.id) || recording;
        selectRecording(current);
    });
    return div;
}

function updateVideoListItem(el, recording) {
    const title = el.querySelector('.video-item-title');
    if (title) title.textContent = getDisplayName(recording);

    // Update meta (time + duration)
    const meta = el.querySelector('.video-item-meta');
    if (meta) {
        meta.innerHTML = '';
        const timeStr = formatTime(recording);
        const durationStr = formatDuration(recording.duration);
        if (timeStr) {
            const timeChip = document.createElement('span');
            timeChip.className = 'meta-chip';
            timeChip.innerHTML = `<span class="material-symbols-rounded meta-icon">schedule</span>${timeStr}`;
            meta.appendChild(timeChip);
        }
        if (durationStr) {
            const durChip = document.createElement('span');
            durChip.className = 'meta-chip';
            durChip.innerHTML = `<span class="material-symbols-rounded meta-icon">timer</span>${durationStr}`;
            meta.appendChild(durChip);
        }
    }

    // Update or remove badge
    const existingBadge = el.querySelector('.status-badge');
    if (recording.insights_status === 'ready') {
        if (existingBadge) existingBadge.remove();
    } else {
        const status = getStatusInfo(recording.insights_status);
        if (existingBadge) {
            existingBadge.className = `status-badge ${status.cls}`;
            existingBadge.innerHTML = `<span class="status-icon"><span class="status-dot"></span></span>${status.label}`;
        } else {
            const badge = document.createElement('span');
            badge.className = `status-badge ${status.cls}`;
            badge.innerHTML = `<span class="status-icon"><span class="status-dot"></span></span>${status.label}`;
            el.appendChild(badge);
        }
    }
}

// --- Selection ---

function selectRecording(recording, autoplay = false) {
    activeRecordingId = recording.id;
    activeRecording = recording;
    updateActiveItemStyle();
    showPlayer(recording, autoplay);
    updatePlayerHeader(recording);
}

// --- Delete with undo ---

let deleteTimer = null;
let pendingDelete = null;

function initiateDelete(recording) {
    const el = document.querySelector(`.video-item[data-id="${recording.id}"]`);

    // Flush any previous pending delete immediately
    if (pendingDelete) {
        clearTimeout(deleteTimer);
        const prev = pendingDelete;
        pendingDelete = null;
        if (prev.el) prev.el.remove();
        window.recorderAPI.deleteRecording(prev.recording.id)
            .catch(err => console.error('Delete failed:', err));
    }

    // Two-phase animation: slide with red trail, then collapse height
    if (el) {
        el.classList.add('deleting-slide');
        setTimeout(() => el.classList.add('deleting-collapse'), 400);
    }

    // Remove from in-memory array
    const idx = loadedRecordings.findIndex(r => r.id === recording.id);
    if (idx !== -1) loadedRecordings.splice(idx, 1);

    // If this was the active recording, select the next/previous one
    if (activeRecordingId === recording.id) {
        activeRecordingId = null;
        activeRecording = null;
        activeStreamUrl = null;
        // Auto-select neighbor: prefer the item that took its place (same index), else previous
        const nextRec = loadedRecordings[idx] || loadedRecordings[idx - 1];
        if (nextRec) {
            selectRecording(nextRec);
        } else {
            const emptyPlayer = document.getElementById('emptyPlayer');
            const playerArea = document.getElementById('videoPlayerArea');
            if (emptyPlayer) emptyPlayer.style.display = '';
            if (playerArea) playerArea.style.display = 'none';
        }
    }

    // Store for undo
    pendingDelete = { recording, el, index: idx };
    showUndoToast();

    // Execute delete after 5s
    deleteTimer = setTimeout(async () => {
        hideUndoToast();
        if (pendingDelete && pendingDelete.recording.id === recording.id) {
            pendingDelete = null;
            if (el) el.remove();
            const result = await window.recorderAPI.deleteRecording(recording.id);
            if (!result.success) showToast('Delete failed: ' + result.error, 'error');
        }
    }, 5000);
}

function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(deleteTimer);

    const { recording, el, index } = pendingDelete;
    pendingDelete = null;
    hideUndoToast();
    showToast('Action undone', 'success');

    // Re-insert into array at original position
    if (index >= 0 && index <= loadedRecordings.length) {
        loadedRecordings.splice(index, 0, recording);
    } else {
        loadedRecordings.push(recording);
    }

    // Restore DOM element
    if (el) {
        el.classList.remove('deleting-slide', 'deleting-collapse');
    }

    // Re-select if it was active
    if (activeRecordingId === null) {
        selectRecording(recording);
    }
}

function showUndoToast() {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    const icon = document.getElementById('toastIcon');
    const undoBtn = document.getElementById('undoBtn');
    if (!toast || !msg) return;
    msg.textContent = 'Recording deleted';
    if (icon) icon.textContent = 'delete';
    if (undoBtn) undoBtn.style.display = '';
    toast.classList.add('visible');
}

function hideUndoToast() {
    const toast = document.getElementById('toast');
    const undoBtn = document.getElementById('undoBtn');
    if (toast) toast.classList.remove('visible');
    if (undoBtn) undoBtn.style.display = 'none';
}

function updateActiveItemStyle() {
    document.querySelectorAll('.video-item').forEach(item => {
        item.classList.toggle('active', Number(item.dataset.id) === activeRecordingId);
    });
}

// --- Player ---

function showPlayer(recording, autoplay = false) {
    const video = document.getElementById('historyVideoPlayer');
    const emptyPlayer = document.getElementById('emptyPlayer');
    const playerArea = document.getElementById('videoPlayerArea');
    const processingOverlay = document.getElementById('playerProcessing');
    if (emptyPlayer) emptyPlayer.style.display = 'none';
    if (playerArea) playerArea.style.display = '';

    if (!video) return;

    // Skip reload if the same stream is already loaded
    if (recording.stream_url && recording.stream_url === activeStreamUrl) return;

    // Clear previous playback
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    video.removeAttribute('src');
    video.load();
    activeStreamUrl = recording.stream_url || null;

    if (!recording.stream_url) {
        if (processingOverlay) processingOverlay.classList.add('visible');
        return;
    }
    if (processingOverlay) processingOverlay.classList.remove('visible');

    if (Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(recording.stream_url);
        hlsInstance.attachMedia(video);
        if (autoplay) {
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play().catch(() => {});
            });
        }
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = recording.stream_url;
        if (autoplay) {
            video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); }, { once: true });
        }
    }
}

// --- Player Header ---

function updatePlayerHeader(recording) {
    const header = document.getElementById('playerHeader');
    const title = document.getElementById('playerTitle');
    const titleInput = document.getElementById('playerTitleInput');
    const downloadSplit = document.getElementById('downloadSplit');

    if (header) header.style.display = 'flex';

    // Title — skip if user is actively editing
    const isEditing = titleInput && titleInput.style.display !== 'none';
    if (!isEditing) {
        if (title) {
            title.textContent = getDisplayName(recording);
            title.style.display = '';
        }
        if (titleInput) titleInput.style.display = 'none';
    }

    // Share button — enabled when video is ready
    setShareState(recording.video_id ? 'default' : 'disabled');

    // Download split — enabled when stream URL exists
    if (downloadSplit) {
        downloadSplit.classList.toggle('disabled', !recording.stream_url);
    }

    // Chat button — enabled when both video_id and collection_id exist
    const chatBtn = document.getElementById('chatBarBtn');
    if (chatBtn) {
        const canChat = !!(recording.video_id && recording.collection_id);
        chatBtn.disabled = !canChat;
        chatBtn.style.opacity = canChat ? '' : '0.4';
        chatBtn.style.pointerEvents = canChat ? '' : 'none';
    }
}

// --- Editable Name ---

function startNameEdit() {
    if (!activeRecording) return;
    const title = document.getElementById('playerTitle');
    const editBtn = document.getElementById('editNameBtn');
    const titleInput = document.getElementById('playerTitleInput');
    if (!title || !titleInput) return;

    title.style.display = 'none';
    if (editBtn) editBtn.style.display = 'none';
    titleInput.style.display = 'block';
    titleInput.value = getDisplayName(activeRecording);
    titleInput.focus();
    titleInput.select();
}

async function commitNameEdit() {
    const title = document.getElementById('playerTitle');
    const editBtn = document.getElementById('editNameBtn');
    const titleInput = document.getElementById('playerTitleInput');
    if (!title || !titleInput || !activeRecording) return;

    const newName = titleInput.value.trim();
    title.style.display = '';
    if (editBtn) editBtn.style.display = '';
    titleInput.style.display = 'none';

    if (newName && newName !== getDisplayName(activeRecording)) {
        activeRecording.name = newName;
        title.textContent = newName;

        // Update the sidebar item
        const item = document.querySelector(`.video-item[data-id="${activeRecording.id}"] .video-item-title`);
        if (item) item.textContent = newName;

        await window.recorderAPI.updateRecordingName(activeRecording.id, newName);
    }
}

function cancelNameEdit() {
    const title = document.getElementById('playerTitle');
    const editBtn = document.getElementById('editNameBtn');
    const titleInput = document.getElementById('playerTitleInput');
    if (title) title.style.display = '';
    if (editBtn) editBtn.style.display = '';
    if (titleInput) titleInput.style.display = 'none';
}

// --- Share ---

function setShareState(state) {
    const btn = document.getElementById('shareBtn');
    const icon = document.getElementById('shareBtnIcon');
    const label = document.getElementById('shareBtnLabel');
    if (!btn || !icon || !label) return;

    btn.classList.remove('processing', 'done');
    btn.disabled = false;

    switch (state) {
        case 'default':
            icon.textContent = 'link';
            label.textContent = 'Copy Link';
            break;
        case 'processing':
            btn.classList.add('processing');
            icon.textContent = '';
            const spinner = document.createElement('span');
            spinner.className = 'btn-spinner';
            icon.appendChild(spinner);
            label.textContent = 'Generating link...';
            break;
        case 'done':
            btn.classList.add('done');
            icon.textContent = 'check';
            label.textContent = 'Link Copied';
            break;
        case 'disabled':
            icon.textContent = 'link';
            label.textContent = 'Copy Link';
            btn.disabled = true;
            break;
    }
}

async function handleShare() {
    if (!activeRecording?.video_id) return;

    setShareState('processing');

    try {
        const result = await window.recorderAPI.getShareUrl(activeRecording.video_id);
        if (result.success && (result.playerUrl || result.streamUrl)) {
            const url = result.playerUrl || result.streamUrl;
            await navigator.clipboard.writeText(url);
            setShareState('done');
            showToast('Link copied to clipboard');
            setTimeout(() => setShareState('default'), 2500);
        } else {
            showToast(result.error || 'Could not generate link', 'error');
            setShareState('default');
        }
    } catch (err) {
        showToast('Failed to generate link', 'error');
        setShareState('default');
    }
}

// --- Chat with Video ---

function setChatState(state) {
    const btn = document.getElementById('chatBarBtn');
    if (!btn) return;
    const icon = btn.querySelector('.material-symbols-rounded');
    const label = btn.querySelector('span:last-child');
    if (!icon || !label) return;

    btn.classList.remove('chat-redirecting');

    switch (state) {
        case 'default':
            icon.textContent = 'chat_bubble_outline';
            label.textContent = 'Chat with video';
            btn.style.pointerEvents = '';
            break;
        case 'redirecting':
            btn.classList.add('chat-redirecting');
            icon.textContent = 'open_in_new';
            label.textContent = 'Redirecting...';
            btn.style.pointerEvents = 'none';
            break;
    }
}

async function handleChatWithVideo() {
    if (!activeRecording?.video_id || !activeRecording?.collection_id) return;

    setChatState('redirecting');

    try {
        const result = await window.recorderAPI.openChatUrl(activeRecording.video_id, activeRecording.collection_id);
        if (!result.success) {
            showToast(result.error || 'Could not open chat', 'error');
        }
    } catch (err) {
        showToast('Failed to open chat', 'error');
    }

    setTimeout(() => setChatState('default'), 2000);
}

// --- Auto-sync pending recordings ---

async function syncPendingRecordings() {
    try {
        const result = await window.recorderAPI.syncPendingRecordings();
        if (result.success && result.resolved > 0) {
            loadHistoryList();
        }
    } catch (_) {
        // Silent — startup sync already handles retries
    }
}

// --- Toast ---

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    const icon = document.getElementById('toastIcon');
    const undoBtn = document.getElementById('undoBtn');
    if (!toast || !msg) return;
    msg.textContent = message;
    if (icon) icon.textContent = type === 'error' ? 'priority_high' : 'check';
    if (undoBtn) undoBtn.style.display = 'none';
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2500);
}

// --- Download ---

function setDownloadState(state) {
    const split = document.getElementById('downloadSplit');
    const icon = document.getElementById('downloadBtnIcon');
    const label = document.getElementById('downloadBtnLabel');
    if (!split || !icon || !label) return;

    split.classList.remove('downloading', 'downloaded', 'disabled');

    switch (state) {
        case 'default':
            icon.textContent = 'download';
            label.textContent = 'Download';
            break;
        case 'downloading':
            split.classList.add('downloading');
            icon.textContent = '';
            const spinner = document.createElement('span');
            spinner.className = 'btn-spinner';
            icon.appendChild(spinner);
            label.textContent = 'Preparing...';
            break;
        case 'downloaded':
            split.classList.add('downloaded');
            icon.textContent = 'check';
            label.textContent = 'Downloaded';
            break;
        case 'disabled':
            split.classList.add('disabled');
            icon.textContent = 'download';
            label.textContent = 'Download';
            break;
    }
}

async function handleDownloadVideo() {
    if (!activeRecording?.video_id) return;

    setDownloadState('downloading');

    try {
        const result = await window.recorderAPI.downloadVideo(activeRecording.video_id);
        if (result.success) {
            setDownloadState('downloaded');
            showToast('Video downloaded');
            setTimeout(() => setDownloadState('default'), 2500);
        } else if (result.error === 'Cancelled') {
            setDownloadState('default');
        } else {
            showToast(result.error || 'Download failed', 'error');
            setDownloadState('default');
        }
    } catch (err) {
        showToast('Download failed', 'error');
        setDownloadState('default');
    }
}

async function handleDownloadTranscript() {
    if (!activeRecording?.id) return;

    setDownloadState('downloading');

    try {
        const result = await window.recorderAPI.downloadTranscript(activeRecording.id);
        if (result.success) {
            setDownloadState('downloaded');
            showToast('Transcript downloaded');
            setTimeout(() => setDownloadState('default'), 2500);
        } else if (result.error === 'Cancelled') {
            setDownloadState('default');
        } else {
            showToast(result.error || 'Download failed', 'error');
            setDownloadState('default');
        }
    } catch (err) {
        showToast('Download failed', 'error');
        setDownloadState('default');
    }
}

// --- Recording Button ---

function setRecordingBtnState(state) {
    const btn = document.getElementById('recordBtn');
    const icon = document.getElementById('recordBtnIcon');
    if (!btn || !icon) return;

    btn.classList.remove('recording', 'gearing-up');
    btn.disabled = false;

    switch (state) {
        case 'idle':
            icon.textContent = 'radio_button_checked';
            btn.dataset.tooltip = 'Start a recording';
            break;
        case 'gearing-up':
            btn.classList.add('gearing-up');
            btn.disabled = true;
            icon.textContent = 'progress_activity';
            btn.dataset.tooltip = 'Starting recording...';
            break;
        case 'recording':
            btn.classList.add('recording');
            icon.textContent = 'stop_circle';
            btn.dataset.tooltip = 'Stop Recording';
            break;
    }
}

async function initRecordingButton() {
    const btn = document.getElementById('recordBtn');
    if (!btn) return;

    // Get initial state
    const state = await window.recorderAPI.getRecordingState();
    setRecordingBtnState(state || 'idle');

    // Listen for state changes
    window.recorderAPI.onRecordingStateChanged((state) => {
        setRecordingBtnState(state);
    });

    // Click handler
    btn.addEventListener('click', () => {
        window.recorderAPI.toggleRecording();
    });
}

// --- Settings Popover ---

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    window.configAPI.saveConfig({ theme });
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
}

async function initSettings() {
    const popover = document.getElementById('settingsPopover');
    const settingsBtn = document.getElementById('settingsBtn');

    // Toggle popover
    settingsBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isOpen = popover.classList.contains('visible');
        if (isOpen) {
            popover.classList.remove('visible');
            return;
        }
        // Load current data
        const config = await window.configAPI.getConfig();
        const currentTheme = config.theme || 'dark';
        document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === currentTheme);
        });
        // Sync launch-on-startup toggle
        const openAtLoginCheckbox = document.getElementById('openAtLoginCheckbox');
        if (openAtLoginCheckbox) {
            openAtLoginCheckbox.checked = !!config.openAtLogin;
        }
        popover.classList.add('visible');
    });

    // Launch on startup toggle
    const openAtLoginCheckbox = document.getElementById('openAtLoginCheckbox');
    openAtLoginCheckbox?.addEventListener('change', () => {
        window.configAPI.saveConfig({ openAtLogin: openAtLoginCheckbox.checked });
    });

    // Close on outside click (mousedown works in drag regions too)
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.settings-popover-wrap')) {
            popover?.classList.remove('visible');
        }
    });

    // Theme toggle
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });

    // Apply saved theme on load
    const config = await window.configAPI.getConfig();
    applyTheme(config.theme || 'dark');

    // Listen for theme changes from other windows (don't save back to avoid loop)
    window.configAPI.onThemeChanged((newTheme) => {
        document.documentElement.setAttribute('data-theme', newTheme);
        document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === newTheme);
        });
    });
}

// Start
init();
initSettings();
