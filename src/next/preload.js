// Bridge between the context-isolated renderers and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bloom', {
  getState: () => ipcRenderer.invoke('next:get-state'),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('next:state', handler);
    return () => ipcRenderer.removeListener('next:state', handler);
  },
  command: (name, args) => ipcRenderer.send('next:command', name, args || {}),
  onView: (listener) => {
    const handler = (_event, view) => listener(view);
    ipcRenderer.on('next:view', handler);
    return () => ipcRenderer.removeListener('next:view', handler);
  },
  // Window-level actions that are not capture commands.
  ui: (name, args) => ipcRenderer.send('next:ui', name, args || {}),
});
