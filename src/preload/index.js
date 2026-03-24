const { contextBridge, ipcRenderer } = require('electron');

// Expose Capture SDK API to renderer process
contextBridge.exposeInMainWorld('recorderAPI', {
    startSession: (sessionId, config) => ipcRenderer.invoke('recorder-start-recording', sessionId, config),
    stopSession: (sessionId) => ipcRenderer.invoke('recorder-stop-recording', sessionId),
    requestPermission: (type) => ipcRenderer.invoke('recorder-request-permission', type),
    pauseTracks: (sessionId, tracks) => ipcRenderer.invoke('recorder-pause-tracks', sessionId, tracks),
    resumeTracks: (sessionId, tracks) => ipcRenderer.invoke('recorder-resume-tracks', sessionId, tracks),
    onRecorderEvent: (callback) => ipcRenderer.on('recorder-event', (event, data) => callback(data)),
    getRecordings: (offset = 0, search = null) => ipcRenderer.invoke('get-recordings', offset, search),
    getRecordingsByIds: (ids) => ipcRenderer.invoke('get-recordings-by-ids', ids),
    syncPendingRecordings: () => ipcRenderer.invoke('sync-pending-recordings'),
    getShareUrl: (videoId) => ipcRenderer.invoke('get-share-url', videoId),
    downloadVideo: (videoId) => ipcRenderer.invoke('download-video', videoId),
    downloadTranscript: (recordingId) => ipcRenderer.invoke('download-transcript', recordingId),
    openChatUrl: (videoId, collectionId) => ipcRenderer.invoke('open-chat-url', videoId, collectionId),
    updateRecordingName: (id, name) => ipcRenderer.invoke('update-recording-name', id, name),
    listDevices: () => ipcRenderer.invoke('list-devices'),

    // Electron specific permission checks logic (optional fallback)
    checkMicPermission: () => ipcRenderer.invoke('check-mic-permission'),
    checkScreenPermission: () => ipcRenderer.invoke('check-screen-permission'),
    checkCameraPermission: () => ipcRenderer.invoke('check-camera-permission'),
    requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),
    requestCameraPermission: () => ipcRenderer.invoke('request-camera-permission'),
    toggleCamera: (show) => ipcRenderer.invoke(show ? 'camera-show' : 'camera-hide'),
    openSystemSettings: (type) => ipcRenderer.invoke('open-system-settings', type),
    openHistoryWindow: (focusSessionId) => ipcRenderer.invoke('open-history-window', focusSessionId),
    onFocusRecording: (callback) => ipcRenderer.on('history:focus-recording', (_event, sessionId) => callback(sessionId)),
    showPermissionsModal: () => ipcRenderer.invoke('show-permissions-modal'),
    showOnboardingModal: () => ipcRenderer.invoke('show-onboarding-modal'),
    modalComplete: (result) => ipcRenderer.send('modal-complete', result),
    setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
    hideBar: () => ipcRenderer.send('hide-bar'),
    showBar: () => ipcRenderer.send('show-bar'),
    notifyRecordingState: (recording) => ipcRenderer.send('recording-state-changed', recording),
    showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
    openDisplayPicker: (payload) => ipcRenderer.invoke('open-display-picker', payload),
    onDisplayPickerInit: (callback) => ipcRenderer.on('display-picker:init', (_event, data) => callback(data)),
    selectDisplayFromPicker: (selection) => ipcRenderer.send('display-picker:select', selection),
    cancelDisplayPicker: () => ipcRenderer.send('display-picker:cancel'),
    toggleRecording: () => ipcRenderer.send('toggle-recording'),
    getRecordingState: () => ipcRenderer.invoke('get-recording-state'),
    onRecordingStateChanged: (callback) => ipcRenderer.on('recording-state-update', (_event, state) => callback(state)),
});

// Config API
contextBridge.exposeInMainWorld('configAPI', {
    getConfig: () => ipcRenderer.invoke('get-settings'),
    saveConfig: (data) => ipcRenderer.invoke('save-settings', data),
    register: (data) => ipcRenderer.invoke('register', data),
    logout: () => ipcRenderer.invoke('recorder-logout'),
    openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
    onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_event, theme) => callback(theme))
});
