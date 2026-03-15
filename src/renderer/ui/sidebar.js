/**
 * Sidebar Logic: Session Control, Source Toggles, Profile
 */
import { addLog } from '../utils/logger.js';

// DOM Elements
const elements = {
    btnStart: document.getElementById('btn-start-session'),
    btnStop: document.getElementById('btn-stop-session'),

    toggleMic: document.getElementById('toggle-mic'),
    toggleScreen: document.getElementById('toggle-screen'),
    toggleCamera: document.getElementById('toggle-camera'),
    toggleAudio: document.getElementById('toggle-audio'),

    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),

    profileContainer: document.getElementById('userProfileContainer'),
    profileMenu: document.getElementById('profileMenu'),
    menuLogoutBtn: document.getElementById('menuLogoutBtn'),

    settingsSection: document.getElementById('settingsSection'),

    renameRow: document.getElementById('renameRow'),
    renameInput: document.getElementById('renameInput'),
    renameSaveBtn: document.getElementById('renameSaveBtn'),
};

// State
let activeSessionId = null;
let lastSessionId = null;
let timerInterval = null;
let timerSeconds = 0;

// --- Initialization ---
export async function initSidebar(onStartSessionCallback) {
    loadConfigToUI();
    initProfileLogic();
    initSettingsLogic();
    resetToggles();

    if (elements.btnStart) {
        elements.btnStart.addEventListener('click', () => {
            if (elements.btnStart.disabled) return;
            onStartSessionCallback();
        });
    }

    if (elements.btnStop) {
        elements.btnStop.addEventListener('click', async () => {
            if (!activeSessionId) return;
            await stopSession();
        });
    }

    bindToggleEvents();
    bindRenameEvents();
}

// --- Session State Management ---

export function setSessionActive(sessionId) {
    activeSessionId = sessionId;
    hideRenameRow();

    if (elements.btnStart) elements.btnStart.classList.add('hidden');
    if (elements.btnStop) {
        elements.btnStop.style.display = 'flex';
        elements.btnStop.classList.remove('hidden');
    }

    if (elements.statusBadge) {
        elements.statusBadge.className = 'status-badge recording';
    }
    startTimer();

    enableToggles(true);
    resetToggles();
}

export function setSessionLoading() {
    if (elements.btnStart) {
        elements.btnStart.disabled = true;
        elements.btnStart.classList.add('loading');
    }
    if (elements.statusBadge) {
        elements.statusBadge.className = 'status-badge starting';
    }
    if (elements.statusText) {
        elements.statusText.textContent = 'Starting';
    }
}

export function resetSessionUI() {
    if (activeSessionId) {
        lastSessionId = activeSessionId;
    }
    activeSessionId = null;

    if (elements.btnStart) {
        elements.btnStart.classList.remove('hidden', 'loading');
        elements.btnStart.style.display = 'flex';
        elements.btnStart.disabled = false;
    }

    // Show rename row if there was a recording
    if (lastSessionId) {
        showRenameRow();
    }
    if (elements.btnStop) {
        elements.btnStop.style.display = 'none';
    }

    stopTimer();
    if (elements.statusBadge) {
        elements.statusBadge.className = 'status-badge';
    }
    if (elements.statusText) {
        elements.statusText.textContent = 'Ready';
    }

    enableToggles(false);
    resetToggles();
}

async function stopSession() {
    if (!activeSessionId) return;
    try {
        const result = await window.recorderAPI.stopSession(activeSessionId);
        if (result.success) {
            addLog('Recording stopped', 'success');
        } else {
            addLog(`Failed to stop: ${result.error}`, 'error');
        }
        resetSessionUI();
    } catch (error) {
        addLog(`Stop error: ${error.message}`, 'error');
        resetSessionUI();
    }
}

// --- Recording Timer ---

function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function startTimer() {
    stopTimer();
    timerSeconds = 0;
    if (elements.statusText) {
        elements.statusText.textContent = `Rec ${formatTime(0)}`;
    }
    timerInterval = setInterval(() => {
        timerSeconds++;
        if (elements.statusText) {
            elements.statusText.textContent = `Rec ${formatTime(timerSeconds)}`;
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    timerSeconds = 0;
}

export function getActiveSessionId() {
    return activeSessionId;
}

// --- Quick Rename ---

function showRenameRow() {
    if (!elements.renameRow || !elements.renameInput) return;
    elements.renameRow.classList.remove('hidden');
    elements.renameInput.value = '';
    elements.renameInput.focus();
}

function hideRenameRow() {
    if (!elements.renameRow) return;
    elements.renameRow.classList.add('hidden');
    if (elements.renameInput) elements.renameInput.value = '';
}

async function saveRecordingName() {
    const name = elements.renameInput ? elements.renameInput.value.trim() : '';
    if (!name || !lastSessionId) {
        hideRenameRow();
        return;
    }
    try {
        await window.recorderAPI.updateRecordingName(lastSessionId, name);
        addLog('Recording renamed', 'success');
    } catch (err) {
        addLog(`Rename failed: ${err.message}`, 'error');
    }
    hideRenameRow();
}

function bindRenameEvents() {
    if (elements.renameSaveBtn) {
        elements.renameSaveBtn.addEventListener('click', saveRecordingName);
    }
    if (elements.renameInput) {
        elements.renameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveRecordingName();
            if (e.key === 'Escape') hideRenameRow();
        });
    }
}

// --- Source Toggle Buttons ---

function bindToggleEvents() {
    const toggleMap = [
        { el: elements.toggleMic, track: 'mic' },
        { el: elements.toggleScreen, track: 'screen' },
        { el: elements.toggleAudio, track: 'system_audio' },
        { el: elements.toggleCamera, track: 'camera' },
    ];

    for (const { el, track } of toggleMap) {
        if (!el) continue;
        el.addEventListener('click', () => {
            if (el.classList.contains('disabled')) return;
            const isActive = el.classList.toggle('active');
            handleToggle(track, isActive);
        });
    }
}

async function handleToggle(trackName, isActive) {
    if (trackName === 'camera') {
        try {
            await window.recorderAPI.toggleCamera(isActive);
            addLog(isActive ? 'Camera On' : 'Camera Off', 'info');
        } catch (err) {
            console.error(err);
        }
        return;
    }

    try {
        if (isActive) {
            addLog(`Resuming ${trackName}...`);
            await window.recorderAPI.resumeTracks(activeSessionId, [trackName]);
        } else {
            addLog(`Pausing ${trackName}...`);
            await window.recorderAPI.pauseTracks(activeSessionId, [trackName]);
        }
    } catch (error) {
        addLog(`Failed to toggle ${trackName}: ${error.message}`, 'error');
    }
}

function enableToggles(enabled) {
    const toggles = [elements.toggleMic, elements.toggleScreen, elements.toggleAudio];
    for (const t of toggles) {
        if (!t) continue;
        if (enabled) {
            t.classList.remove('disabled');
            t.disabled = false;
        } else {
            t.classList.add('disabled');
            t.disabled = true;
        }
    }
}

function resetToggles() {
    const toggles = [elements.toggleMic, elements.toggleScreen, elements.toggleAudio];
    for (const t of toggles) {
        if (t) t.classList.add('active');
    }
}

// --- Settings ---

function initSettingsLogic() {
    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.addEventListener('click', () => {
            if (window.recorderAPI && window.recorderAPI.openHistoryWindow) {
                window.recorderAPI.openHistoryWindow();
            }
        });
    }
}

// --- Profile ---

async function loadConfigToUI() {
    try {
        const config = await window.configAPI.getConfig();
        let displayName = config.userName || 'VideoDB User';

        const tooltip = document.getElementById('userNameTooltip');
        const menuName = document.getElementById('menuUserName');
        if (tooltip) tooltip.textContent = displayName;
        if (menuName) menuName.textContent = displayName;
    } catch (err) {
        console.error('Failed to load config', err);
    }
}

function initProfileLogic() {
    const { profileContainer, profileMenu, menuLogoutBtn } = elements;

    if (profileContainer && profileMenu) {
        profileContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = profileMenu.classList.toggle('visible');
            profileContainer.classList.toggle('menu-open', isVisible);
        });

        document.addEventListener('click', () => {
            profileMenu.classList.remove('visible');
            profileContainer.classList.remove('menu-open');
        });

        profileMenu.addEventListener('click', (e) => e.stopPropagation());
    }

    if (menuLogoutBtn) {
        menuLogoutBtn.addEventListener('click', async () => {
            if (profileMenu) profileMenu.classList.remove('visible');
            if (confirm('Are you sure you want to log out?')) {
                await window.configAPI.logout();
                window.location.reload();
            }
        });
    }
}
