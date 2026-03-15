const { contextBridge, ipcRenderer } = require('electron');

// Expose Capture SDK API to renderer process
contextBridge.exposeInMainWorld('recorderAPI', {
    startSession: (sessionId, config) => ipcRenderer.invoke('recorder-start-recording', sessionId, config),
    stopSession: (sessionId) => ipcRenderer.invoke('recorder-stop-recording', sessionId),
    requestPermission: (type) => ipcRenderer.invoke('recorder-request-permission', type),
    pauseTracks: (sessionId, tracks) => ipcRenderer.invoke('recorder-pause-tracks', sessionId, tracks),
    resumeTracks: (sessionId, tracks) => ipcRenderer.invoke('recorder-resume-tracks', sessionId, tracks),
    onRecorderEvent: (callback) => ipcRenderer.on('recorder-event', (event, data) => callback(data)),
    getRecordings: () => ipcRenderer.invoke('get-recordings'),
    getShareUrl: (videoId) => ipcRenderer.invoke('get-share-url', videoId),
    updateRecordingName: (id, name) => ipcRenderer.invoke('update-recording-name', id, name),

    // Electron specific permission checks logic (optional fallback)
    checkMicPermission: () => ipcRenderer.invoke('check-mic-permission'),
    checkScreenPermission: () => ipcRenderer.invoke('check-screen-permission'),
    checkCameraPermission: () => ipcRenderer.invoke('check-camera-permission'),
    requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),
    requestCameraPermission: () => ipcRenderer.invoke('request-camera-permission'),
    toggleCamera: (show) => ipcRenderer.invoke(show ? 'camera-show' : 'camera-hide'),
    openSystemSettings: (type) => ipcRenderer.invoke('open-system-settings', type),
    openHistoryWindow: () => ipcRenderer.invoke('open-history-window'),
    notifyRecordingState: (recording) => ipcRenderer.send('recording-state-changed', recording),
    showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
});

// Config API
contextBridge.exposeInMainWorld('configAPI', {
    getConfig: () => ipcRenderer.invoke('get-settings'),
    register: (data) => ipcRenderer.invoke('register', data),
    logout: () => ipcRenderer.invoke('recorder-logout'),
    openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url)
});
