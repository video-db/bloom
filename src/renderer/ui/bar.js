/**
 * Floating Bar: Session Control, Source Toggles, Device Selection
 */
import { addLog } from '../utils/logger.js';

// DOM Elements
const elements = {
    btnStart: document.getElementById('btn-start-session'),
    btnStop: document.getElementById('btn-stop-session'),
    btnClose: document.getElementById('btn-close'),
    btnLibrary: document.getElementById('btn-library'),

    toggleMic: document.getElementById('toggle-mic'),
    toggleScreen: document.getElementById('toggle-screen'),
    toggleCamera: document.getElementById('toggle-camera'),
    toggleAudio: document.getElementById('toggle-audio'),

    displaySelector: document.getElementById('displaySelector'),

    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),

    mainApp: document.getElementById('mainApp'),

    renameRow: document.getElementById('renameRow'),
    renameInput: document.getElementById('renameInput'),
    renameSaveBtn: document.getElementById('renameSaveBtn'),
};

// State
let activeSessionId = null;
let lastSessionId = null;
let timerInterval = null;
let timerStartedAt = null;

// Device state
let devices = { mics: [], systemAudio: [], displays: [] };
let selectedMicId = null;
let selectedAudioId = null;
let selectedDisplayId = null;

// --- Initialization ---
export async function initBar(onStartSessionCallback) {
    initCloseButton();
    initLibraryButton();

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
    bindDisplaySelectorEvents();
    bindRenameEvents();
    initClickThrough();
}

// --- Close Button ---

function initCloseButton() {
    if (elements.btnClose) {
        elements.btnClose.addEventListener('click', () => {
            window.recorderAPI.hideBar();
        });
    }
}

function initLibraryButton() {
    if (elements.btnLibrary) {
        elements.btnLibrary.addEventListener('click', () => {
            window.recorderAPI.openHistoryWindow();
        });
    }
}

// --- Click-Through ---
// Transparent area passes clicks to apps behind. Only the bar itself is interactive.

function initClickThrough() {
    const bar = elements.mainApp;
    if (!bar || !window.recorderAPI?.setIgnoreMouse) return;

    // mouseenter/mouseleave don't fire reliably when setIgnoreMouseEvents
    // is active with { forward: true }. Use document-level mousemove with
    // bounding-rect hit testing instead.
    let isOverBar = false;
    let isMouseDown = false;

    // Track mouse button state so we never re-enable click-through mid-drag.
    // During a drag the window moves under the cursor, which can momentarily
    // place the cursor outside the bar's bounding rect — without this guard
    // that would flip ignore back on and drop the drag.
    document.addEventListener('mousedown', () => { isMouseDown = true; });
    document.addEventListener('mouseup', () => { isMouseDown = false; });

    document.addEventListener('mousemove', (e) => {
        const rect = bar.getBoundingClientRect();
        // Pad the detection zone by a few px so the IPC toggle takes effect
        // before the cursor visually reaches the bar edge.
        const pad = 4;
        const over =
            e.clientX >= rect.left - pad && e.clientX <= rect.right + pad &&
            e.clientY >= rect.top - pad && e.clientY <= rect.bottom + pad;

        if (over && !isOverBar) {
            isOverBar = true;
            window.recorderAPI.setIgnoreMouse(false);
        } else if (!over && isOverBar && !isMouseDown) {
            isOverBar = false;
            window.recorderAPI.setIgnoreMouse(true);
        }
    });
}

// --- Session State Management ---

export function setSessionActive(sessionId) {
    activeSessionId = sessionId;
    hideRenameRow();

    // Switch to recording layout
    if (elements.mainApp) elements.mainApp.classList.add('recording');

    if (elements.btnStart) elements.btnStart.classList.add('hidden');
    if (elements.btnStop) elements.btnStop.classList.remove('hidden');

    // Mark display pill as active (screen is being captured)
    if (elements.toggleScreen) elements.toggleScreen.classList.add('active');

    if (elements.statusBadge) {
        elements.statusBadge.className = 'status-badge';
        elements.statusBadge.classList.remove('hidden');
    }
    startTimer();

    // Pause any tracks the user toggled off before starting
    pauseDisabledTracks(sessionId);
}

export function setSessionLoading() {
    if (elements.btnStart) {
        elements.btnStart.disabled = true;
        elements.btnStart.classList.add('loading');
        const label = elements.btnStart.querySelector('.btn-label');
        if (label) label.textContent = 'Gearing up\u2026';
    }
}

export function resetSessionUI() {
    if (activeSessionId) {
        lastSessionId = activeSessionId;
    }
    activeSessionId = null;

    // Switch back to idle layout
    if (elements.mainApp) elements.mainApp.classList.remove('recording');

    if (elements.btnStart) {
        elements.btnStart.classList.remove('hidden', 'loading');
        elements.btnStart.disabled = false;
        const label = elements.btnStart.querySelector('.btn-label');
        if (label) label.textContent = 'Start Recording';
    }

    // Open Library window for renaming if there was a recording
    if (lastSessionId) {
        window.recorderAPI.openHistoryWindow(lastSessionId);
    }
    if (elements.btnStop) {
        elements.btnStop.classList.add('hidden');
        elements.btnStop.disabled = false;
        elements.btnStop.style.opacity = '';
    }
    stopTimer();
    if (elements.statusBadge) {
        elements.statusBadge.classList.add('hidden');
    }
    if (elements.statusText) {
        elements.statusText.textContent = 'Ready';
    }

    resetToggles();

    // Reset display pill state
    if (elements.toggleScreen) elements.toggleScreen.classList.remove('active');
}

async function stopSession() {
    if (!activeSessionId) return;

    // Immediate feedback
    if (elements.btnStop) {
        elements.btnStop.disabled = true;
        elements.btnStop.style.opacity = '0.4';
    }

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
    timerStartedAt = Date.now();
    if (elements.statusText) {
        elements.statusText.textContent = formatTime(0);
    }
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
        if (elements.statusText) {
            elements.statusText.textContent = formatTime(elapsed);
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    timerStartedAt = null;
}

export function getActiveSessionId() {
    return activeSessionId;
}

// --- Quick Rename ---

function showRenameRow() {
    if (!elements.renameRow || !elements.renameInput) return;
    if (elements.statusBadge) elements.statusBadge.classList.add('hidden');
    if (elements.btnStart) elements.btnStart.classList.add('hidden');
    elements.renameRow.classList.remove('hidden');
    elements.renameInput.value = '';
    elements.renameInput.focus();
}

function hideRenameRow() {
    if (!elements.renameRow) return;
    elements.renameRow.classList.add('hidden');
    if (elements.renameInput) elements.renameInput.value = '';
    if (elements.btnStart && !activeSessionId) {
        elements.btnStart.classList.remove('hidden');
    }
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

// --- Source Toggle Pills ---

function updatePillVisual(el, isActive) {
    if (!el) return;
    const icon = el.querySelector('.source-icon');
    const label = el.querySelector('.source-label');

    if (isActive) {
        el.classList.add('active');
        if (icon && icon.dataset.on) icon.src = icon.dataset.on;
        if (label && label.dataset.on) label.textContent = label.dataset.on;
    } else {
        el.classList.remove('active');
        if (icon && icon.dataset.off) icon.src = icon.dataset.off;
        if (label && label.dataset.off) label.textContent = label.dataset.off;
    }
}

function bindToggleEvents() {
    // Camera — always interactive, app-level toggle for camera bubble
    if (elements.toggleCamera) {
        elements.toggleCamera.addEventListener('click', async () => {
            const isActive = elements.toggleCamera.classList.contains('active');
            const newState = !isActive;
            updatePillVisual(elements.toggleCamera, newState);
            try {
                await window.recorderAPI.toggleCamera(newState);
                addLog(newState ? 'Camera On' : 'Camera Off', 'info');
            } catch (err) {
                console.error(err);
                // Revert visual on failure
                updatePillVisual(elements.toggleCamera, isActive);
            }
        });
    }

    // Mic & Audio — always interactive.
    // Idle: visual toggle only. Recording: pause/resume via IPC.
    const recordingToggles = [
        { el: elements.toggleMic, track: 'mic' },
        { el: elements.toggleAudio, track: 'system_audio' },
    ];

    for (const { el, track } of recordingToggles) {
        if (!el) continue;
        el.addEventListener('click', async () => {
            const isActive = el.classList.contains('active');
            const newState = !isActive;
            updatePillVisual(el, newState);

            // During recording: pause/resume the track
            if (activeSessionId) {
                try {
                    if (newState) {
                        addLog(`Resuming ${track}...`);
                        await window.recorderAPI.resumeTracks(activeSessionId, [track]);
                    } else {
                        addLog(`Pausing ${track}...`);
                        await window.recorderAPI.pauseTracks(activeSessionId, [track]);
                    }
                } catch (error) {
                    addLog(`Failed to toggle ${track}: ${error.message}`, 'error');
                    updatePillVisual(el, isActive);
                }
            }
        });
    }
}

async function pauseDisabledTracks(sessionId) {
    const trackMap = [
        { el: elements.toggleMic, track: 'mic' },
        { el: elements.toggleAudio, track: 'system_audio' },
    ];
    const toPause = trackMap
        .filter(({ el }) => el && !el.classList.contains('active'))
        .map(({ track }) => track);

    if (toPause.length > 0) {
        try {
            addLog(`Pausing pre-disabled tracks: ${toPause.join(', ')}`);
            await window.recorderAPI.pauseTracks(sessionId, toPause);
        } catch (error) {
            addLog(`Failed to pause tracks: ${error.message}`, 'error');
        }
    }
}

function resetToggles() {
    const toggles = [elements.toggleMic, elements.toggleAudio];
    for (const t of toggles) {
        if (t) updatePillVisual(t, true);
    }
}

// --- Device Discovery ---

export async function loadDevices() {
    try {
        const result = await window.recorderAPI.listDevices();
        if (!result.success) {
            console.error('Failed to list devices:', result.error);
            // Auth expired — show login modal
            if (result.error === 'Not authenticated') {
                await window.recorderAPI.showOnboardingModal();
            }
            return;
        }

        devices = result;

        // Mic — set device name and activate pill
        if (devices.mics.length > 0) {
            const mic = devices.mics[0];
            selectedMicId = mic.id;
            const label = elements.toggleMic?.querySelector('.source-label');
            if (label) {
                label.dataset.on = mic.name;
            }
            updatePillVisual(elements.toggleMic, true);
        }

        // System audio — set device name and activate pill
        if (devices.systemAudio.length > 0) {
            const audio = devices.systemAudio[0];
            selectedAudioId = audio.id;
            const label = elements.toggleAudio?.querySelector('.source-label');
            if (label) {
                label.dataset.on = audio.name;
            }
            updatePillVisual(elements.toggleAudio, true);
        }

        // Displays — populate dropdown and set default
        populateDisplayDropdown(devices.displays);

        console.log(`[Devices] mics: ${devices.mics.length}, audio: ${devices.systemAudio.length}, displays: ${devices.displays.length}`);
    } catch (err) {
        console.error('Error loading devices:', err);
    }
}

function populateDisplayDropdown(displays) {
    const label = document.getElementById('displayLabel');
    if (!label) return;

    if (displays.length === 0) {
        selectedDisplayId = null;
        label.textContent = 'No display';
        return;
    }

    selectedDisplayId = displays[0].id;
    label.textContent = displays[0].name;
}

// --- Display Selector (separate picker window) ---

let displayPickerClosedAt = 0;

function bindDisplaySelectorEvents() {
    const pill = elements.toggleScreen;
    if (!pill || pill.dataset.bound === 'true') return;
    pill.dataset.bound = 'true';

    pill.addEventListener('click', async (e) => {
        e.stopPropagation();

        // During recording: toggle display track pause/resume
        if (activeSessionId) {
            const isActive = pill.classList.contains('active');
            const newState = !isActive;
            pill.classList.toggle('active', newState);
            try {
                if (newState) {
                    addLog('Resuming display...');
                    await window.recorderAPI.resumeTracks(activeSessionId, ['screen']);
                } else {
                    addLog('Pausing display...');
                    await window.recorderAPI.pauseTracks(activeSessionId, ['screen']);
                }
            } catch (error) {
                addLog(`Failed to toggle display: ${error.message}`, 'error');
                pill.classList.toggle('active', isActive);
            }
            return;
        }

        // If picker just closed (blur fires before this click), skip reopening
        if (Date.now() - displayPickerClosedAt < 300) return;

        // Idle mode: open display picker window
        const displayList = Array.isArray(devices.displays) ? devices.displays : [];
        if (displayList.length === 0) {
            addLog('No displays available', 'error');
            return;
        }

        const rect = pill.getBoundingClientRect();
        const anchorRect = {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        };

        try {
            const result = await window.recorderAPI.openDisplayPicker({
                anchorRect,
                displays: displayList,
                selectedDisplayId,
                preferredWidth: 220,
            });

            displayPickerClosedAt = Date.now();

            if (result && !result.cancelled && result.id) {
                selectedDisplayId = result.id;
                const label = document.getElementById('displayLabel');
                if (label) label.textContent = result.name || 'Display';
            }
        } catch (error) {
            displayPickerClosedAt = Date.now();
            addLog(`Display picker failed: ${error.message}`, 'error');
        }
    });
}

export function getSelectedChannels() {
    return {
        micId: selectedMicId,
        audioId: selectedAudioId,
        displayId: selectedDisplayId,
    };
}

