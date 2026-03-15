/**
 * History Window Logic
 */

let hlsInstance = null;
let activeRecordingId = null;
let activeRecording = null;
let activeStreamUrl = null;
let refreshInterval = null;

const STATUS_MAP = {
    recording:  { label: 'Recording',    cls: 'status-recording' },
    pending:    { label: 'Processing',   cls: 'status-pending' },
    processing: { label: 'Generating transcription', cls: 'status-processing' },
    ready:      { label: 'Ready',        cls: 'status-ready' },
    failed:     { label: 'Failed',       cls: 'status-failed' },
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

// --- Init ---

async function init() {
    loadHistoryList();

    document.getElementById('refreshBtn')?.addEventListener('click', loadHistoryList);
    document.getElementById('closeHistoryBtn')?.addEventListener('click', () => window.close());
    document.getElementById('shareBtn')?.addEventListener('click', handleShare);
    document.getElementById('editNameBtn')?.addEventListener('click', () => startNameEdit());

    const input = document.getElementById('videoTitleInput');
    if (input) {
        input.addEventListener('blur', () => commitNameEdit());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { cancelNameEdit(); }
        });
    }
}

// --- List ---

async function loadHistoryList() {
    const listContainer = document.getElementById('historyListContainer');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="empty-state">Loading...</div>';

    try {
        const recordings = await window.recorderAPI.getRecordings();

        if (!recordings || recordings.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">No recordings yet.</div>';
            scheduleAutoRefresh([]);
            return;
        }

        recordings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        listContainer.innerHTML = '';

        const grouped = bucketRecordings(recordings);
        for (const [groupName, items] of Object.entries(grouped)) {
            if (items.length === 0) continue;
            const header = document.createElement('div');
            header.className = 'history-group-header';
            header.textContent = groupName;
            listContainer.appendChild(header);

            items.forEach(rec => listContainer.appendChild(createHistoryListItem(rec)));
        }

        // Auto-select first or preserve selection
        const toSelect = recordings.find(r => r.id === activeRecordingId) || recordings[0];
        if (toSelect) selectRecording(toSelect);

        scheduleAutoRefresh(recordings);
    } catch (error) {
        listContainer.innerHTML = `<div class="empty-state" style="color:var(--error)">Failed to load: ${error.message}</div>`;
    }
}

function scheduleAutoRefresh(recordings) {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    const hasInProgress = recordings.some(r =>
        r.insights_status === 'recording' || r.insights_status === 'pending' || r.insights_status === 'processing'
    );
    if (hasInProgress) {
        refreshInterval = setInterval(loadHistoryList, 5000);
    }
}

function bucketRecordings(recordings) {
    const buckets = { "Today": [], "Yesterday": [], "Earlier": [] };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

    recordings.forEach(rec => {
        if (!rec.created_at) { buckets["Earlier"].push(rec); return; }
        const d = new Date(rec.created_at);
        const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        if (dateOnly.getTime() === today.getTime()) buckets["Today"].push(rec);
        else if (dateOnly.getTime() === yesterday.getTime()) buckets["Yesterday"].push(rec);
        else buckets["Earlier"].push(rec);
    });
    return buckets;
}

function createHistoryListItem(recording) {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.dataset.id = recording.id;
    if (recording.id === activeRecordingId) div.classList.add('active');

    const name = getDisplayName(recording);
    const timeStr = recording.created_at
        ? new Date(recording.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
    const status = getStatusInfo(recording.insights_status);

    div.innerHTML = `
        <div class="history-item-title">${name}</div>
        <div class="history-item-meta">
            <span class="history-item-time">${timeStr}</span>
            <span class="status-badge ${status.cls}">
                <span class="status-dot"></span>
                ${status.label}
            </span>
        </div>
    `;

    div.addEventListener('click', () => selectRecording(recording));
    return div;
}

// --- Selection ---

function selectRecording(recording) {
    activeRecordingId = recording.id;
    activeRecording = recording;
    updateActiveItemStyle();
    loadVideo(recording);
    updateHeader(recording);
    updateTranscriptPanel(recording);
}

function updateActiveItemStyle() {
    document.querySelectorAll('.history-item').forEach(item => {
        item.classList.toggle('active', Number(item.dataset.id) === activeRecordingId);
    });
}

// --- Player ---

function loadVideo(recording) {
    const video = document.getElementById('historyVideoPlayer');
    if (!video) return;

    // Skip reload if the same stream is already playing
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
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {});
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = recording.stream_url;
        video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); }, { once: true });
    }
}

// --- Header ---

function updateHeader(recording) {
    const header = document.getElementById('videoHeader');
    const title = document.getElementById('currentVideoTitle');
    const titleRow = document.getElementById('videoTitleRow');
    const titleInput = document.getElementById('videoTitleInput');
    const badge = document.getElementById('videoStatusBadge');
    const shareBtn = document.getElementById('shareBtn');

    if (header) header.style.display = 'flex';

    // Title
    if (title) title.textContent = getDisplayName(recording);
    if (titleRow) titleRow.style.display = 'flex';
    if (titleInput) titleInput.style.display = 'none';

    // Status badge
    if (badge) {
        const status = getStatusInfo(recording.insights_status);
        badge.innerHTML = `<span class="status-badge ${status.cls}"><span class="status-dot"></span>${status.label}</span>`;
    }

    // Share button — only enabled when video is ready
    if (shareBtn) {
        shareBtn.disabled = !recording.video_id;
        document.getElementById('shareBtnLabel').textContent = 'Share';
    }
}

// --- Editable Name ---

function startNameEdit() {
    if (!activeRecording) return;
    const titleRow = document.getElementById('videoTitleRow');
    const titleInput = document.getElementById('videoTitleInput');
    if (!titleRow || !titleInput) return;

    titleRow.style.display = 'none';
    titleInput.style.display = 'block';
    titleInput.value = getDisplayName(activeRecording);
    titleInput.focus();
    titleInput.select();
}

async function commitNameEdit() {
    const titleRow = document.getElementById('videoTitleRow');
    const titleInput = document.getElementById('videoTitleInput');
    if (!titleRow || !titleInput || !activeRecording) return;

    const newName = titleInput.value.trim();
    titleRow.style.display = 'flex';
    titleInput.style.display = 'none';

    if (newName && newName !== getDisplayName(activeRecording)) {
        activeRecording.name = newName;
        document.getElementById('currentVideoTitle').textContent = newName;

        // Update the sidebar item
        const item = document.querySelector(`.history-item[data-id="${activeRecording.id}"] .history-item-title`);
        if (item) item.textContent = newName;

        await window.recorderAPI.updateRecordingName(activeRecording.id, newName);
    }
}

function cancelNameEdit() {
    const titleRow = document.getElementById('videoTitleRow');
    const titleInput = document.getElementById('videoTitleInput');
    if (titleRow) titleRow.style.display = 'flex';
    if (titleInput) titleInput.style.display = 'none';
}

// --- Share ---

async function handleShare() {
    const shareBtn = document.getElementById('shareBtn');
    const label = document.getElementById('shareBtnLabel');
    if (!shareBtn || !activeRecording?.video_id) return;

    // Enter loading state
    shareBtn.disabled = true;
    label.innerHTML = '<span class="spinner-small"></span> Generating...';

    try {
        const result = await window.recorderAPI.getShareUrl(activeRecording.video_id);
        if (result.success && (result.playerUrl || result.streamUrl)) {
            const url = result.playerUrl || result.streamUrl;
            await navigator.clipboard.writeText(url);
            showToast('Link copied to clipboard');
        } else {
            showToast(result.error || 'Could not generate link');
        }
    } catch (err) {
        showToast('Failed to generate link');
    }

    // Restore button
    label.innerHTML = 'Share';
    shareBtn.disabled = false;
}

// --- Transcript ---

function updateTranscriptPanel(recording) {
    const panel = document.getElementById('insightsContent');
    if (!panel) return;

    if (recording.insights_status === 'ready' && recording.insights) {
        try {
            const data = typeof recording.insights === 'string'
                ? JSON.parse(recording.insights) : recording.insights;
            if (data?.transcript) {
                panel.innerHTML = `<div style="line-height:1.7; color:var(--text-secondary); font-size:13px;">
                    ${data.transcript.replace(/\n/g, '<br>')}
                </div>`;
                return;
            }
        } catch (e) { /* fall through */ }
    }

    const status = getStatusInfo(recording.insights_status);
    const isProcessing = ['recording', 'pending', 'processing'].includes(recording.insights_status);

    panel.innerHTML = `
        <div class="empty-state">
            ${isProcessing ? '<div class="spinner-small" style="margin: 0 auto 10px; border-color: var(--border-light); border-top-color: var(--text-muted);"></div>' : ''}
            <div>${status.label}${isProcessing ? '...' : ''}</div>
        </div>
    `;
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

// Start
init();
