// Bridge between the context-isolated renderers and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bloom', {
  getState: () => ipcRenderer.invoke('bloom:get-state'),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('bloom:state', handler);
    return () => ipcRenderer.removeListener('bloom:state', handler);
  },
  command: (name, args) => ipcRenderer.send('bloom:command', name, args || {}),
  onView: (listener) => {
    const handler = (_event, view) => listener(view);
    ipcRenderer.on('bloom:view', handler);
    return () => ipcRenderer.removeListener('bloom:view', handler);
  },
  onCollectionAction: (listener) => {
    const handler = (_event, action) => listener(action);
    ipcRenderer.on('bloom:collection-action', handler);
    return () => ipcRenderer.removeListener('bloom:collection-action', handler);
  },
  // The clipboard's text, for onboarding's Paste button.
  clipboardText: () => ipcRenderer.invoke('bloom:clipboard-text'),
  // A small still of the screen for onboarding's proof that recording is allowed.
  screenPreview: () => ipcRenderer.invoke('bloom:screen-preview'),
  // Window-level actions that are not capture commands.
  ui: (name, args) => ipcRenderer.send('bloom:ui', name, args || {}),
});
