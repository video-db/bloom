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
        return 'Recording at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return 'Untitled Recording';
}

function formatDuration(recording) {
    if (recording.created_at) {
        return new Date(recording.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return '';
}

// --- Init ---

async function init() {
    // Listen for focus-recording events from the main process (e.g. after recording stops)
    window.recorderAPI.onFocusRecording((sessionId) => {
        pendingFocusSessionId = sessionId;
        loadHistoryList();
    });

    loadHistoryList();

    document.getElementById('homeBtn')?.addEventListener('click', () => window.close());

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
                const labels = { 'date-newest': 'Newest', 'date-oldest': 'Oldest' };
                const sortLabel = document.getElementById('sortLabel');
                if (sortLabel) sortLabel.textContent = labels[sort] || 'Newest';
                // Re-sort list
                applySortToList();
                sortDropdown.classList.remove('visible');
            });
        });
    }

    // Search (filters list client-side by name)
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.video-item').forEach(item => {
            const title = item.querySelector('.video-item-title')?.textContent.toLowerCase() || '';
            item.style.display = title.includes(query) ? '' : 'none';
        });
    });
}

// --- List ---

async function loadHistoryList() {
    const listContainer = document.getElementById('videoListContainer');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="empty-state">Loading...</div>';

    try {
        const recordings = await window.recorderAPI.getRecordings();

        if (!recordings || recordings.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">No recordings yet.</div>';
            scheduleAutoRefresh([]);
            return;
        }

        sortRecordings(recordings);
        listContainer.innerHTML = '';

        recordings.forEach(rec => listContainer.appendChild(createVideoListItem(rec)));

        // Auto-select: pending focus session > previously active > first
        let toSelect = null;
        let shouldAutoplay = false;
        if (pendingFocusSessionId) {
            toSelect = recordings.find(r => r.session_id === pendingFocusSessionId);
            shouldAutoplay = true;
        }
        if (!toSelect) {
            toSelect = recordings.find(r => r.id === activeRecordingId) || recordings[0];
        }
        if (toSelect) {
            selectRecording(toSelect, shouldAutoplay);
            if (pendingFocusSessionId && toSelect.session_id === pendingFocusSessionId) {
                pendingFocusSessionId = null;
                startNameEdit();
            }
        }

        scheduleAutoRefresh(recordings);
    } catch (error) {
        listContainer.innerHTML = `<div class="empty-state" style="color:#EF3535">Failed to load: ${error.message}</div>`;
    }
}

function scheduleAutoRefresh(recordings) {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    const hasInProgress = recordings.some(r =>
        r.insights_status === 'recording' || r.insights_status === 'pending' || r.insights_status === 'processing' || r.insights_status === 'indexing'
    );
    if (hasInProgress) {
        refreshInterval = setInterval(loadHistoryList, 5000);
    }
}

function sortRecordings(recordings) {
    if (currentSort === 'date-oldest') {
        recordings.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else {
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
    const timeStr = formatDuration(recording);
    const status = getStatusInfo(recording.insights_status);

    // Use textContent for name to prevent XSS
    const titleSpan = document.createElement('span');
    titleSpan.className = 'video-item-title';
    titleSpan.textContent = name;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'video-item-time';
    timeSpan.textContent = timeStr;

    const details = document.createElement('div');
    details.className = 'video-item-details';
    details.appendChild(titleSpan);
    details.appendChild(timeSpan);

    const badge = document.createElement('span');
    badge.className = `status-badge ${status.cls}`;
    badge.innerHTML = `<span class="status-icon"><span class="status-dot"></span></span>${status.label}`;

    div.appendChild(details);
    div.appendChild(badge);

    div.addEventListener('click', () => selectRecording(recording, true));
    return div;
}

// --- Selection ---

function selectRecording(recording, autoplay = false) {
    activeRecordingId = recording.id;
    activeRecording = recording;
    updateActiveItemStyle();
    showPlayer(recording, autoplay);
    updatePlayerHeader(recording);
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

    if (!recording.stream_url) return;

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
            showToast(result.error || 'Could not generate link');
            setShareState('default');
        }
    } catch (err) {
        showToast('Failed to generate link');
        setShareState('default');
    }
}

// --- Chat with Video ---

function setChatState(state) {
    const btn = document.getElementById('chatBarBtn');
    if (!btn) return;
    const icon = btn.querySelector('.material-icons-round');
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
            showToast(result.error || 'Could not open chat');
        }
    } catch (err) {
        showToast('Failed to open chat');
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

function showToast(message) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    if (!toast || !msg) return;
    msg.textContent = message;
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
            showToast(result.error || 'Download failed');
            setDownloadState('default');
        }
    } catch (err) {
        showToast('Download failed');
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
            showToast(result.error || 'Download failed');
            setDownloadState('default');
        }
    } catch (err) {
        showToast('Download failed');
        setDownloadState('default');
    }
}

// Start
init();
