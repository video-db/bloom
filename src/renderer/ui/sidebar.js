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
};

// State
let activeSessionId = null;

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
}

// --- Session State Management ---

export function setSessionActive(sessionId) {
    activeSessionId = sessionId;

    if (elements.btnStart) elements.btnStart.classList.add('hidden');
    if (elements.btnStop) {
        elements.btnStop.style.display = 'flex';
        elements.btnStop.classList.remove('hidden');
    }

    if (elements.statusBadge) {
        elements.statusBadge.className = 'status-badge recording';
    }
    if (elements.statusText) {
        elements.statusText.textContent = 'Recording';
    }

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
    activeSessionId = null;

    if (elements.btnStart) {
        elements.btnStart.classList.remove('hidden', 'loading');
        elements.btnStart.style.display = 'flex';
        elements.btnStart.disabled = false;
    }
    if (elements.btnStop) {
        elements.btnStop.style.display = 'none';
    }

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
