// The application menu, and the About panel it opens.
const { app, Menu } = require('electron');

const PREVIEW_SCENARIOS = [
  ['permission', 'Missing permission'],
  ['connection', 'Connection lost'],
  ['meeting-ended', 'Meeting ended'],
  ['stop-failed', 'Stop failed'],
  ['upload-slow', 'Slow upload'],
  ['processing-error', 'Processing failed'],
];

function installMenu({ engine, windows }) {
  app.setAboutPanelOptions({
    applicationName: 'Bloom Preview',
    applicationVersion: 'UI preview',
    copyright:
      'Sample data only. No recording or upload. VideoDB integration is not connected.',
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Bloom',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Settings…',
            accelerator: 'CmdOrCtrl+,',
            click: () => windows.openMain('settings'),
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'New Recording…',
            accelerator: 'CmdOrCtrl+N',
            click: windows.showPanel,
          },
          {
            label: 'Recordings',
            accelerator: 'CmdOrCtrl+1',
            click: () => windows.openMain('library'),
          },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: 'Preview Scenarios',
            submenu: PREVIEW_SCENARIOS.map(([kind, label]) => ({
              label,
              click: () => {
                engine.command('simulate', { kind });
                windows.showPanel();
              },
            })),
          },
          { label: 'About Bloom Preview', click: () => app.showAboutPanel() },
          { label: 'Replay Onboarding', click: windows.openOnboarding },
        ],
      },
    ]),
  );
}

module.exports = { installMenu };
