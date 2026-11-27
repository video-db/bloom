// The application menu, and the About panel it opens.
const { app, Menu } = require('electron');
const { canSignOut } = require('../engine/videodb/model');
const { setupReady, controlsAvailable } = require('./access');

const PREVIEW_SCENARIOS = [
  ['permission', 'Missing permission'],
  ['connection', 'Connection lost'],
  ['meeting-ended', 'Meeting ended'],
  ['stop-failed', 'Stop failed'],
  ['upload-slow', 'Slow upload'],
  ['processing-error', 'Processing failed'],
];

function installMenu({ engine, windows, prefs, exportDiagnostics = null }) {
  const sample = engine.getState().sample;
  app.setAboutPanelOptions({
    applicationName: sample ? 'Bloom Preview' : 'Bloom',
    applicationVersion: sample ? 'UI preview' : app.getVersion?.(),
    copyright: sample
      ? 'Sample data only. No recording or upload.'
      : 'Screen recorder powered by VideoDB',
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Bloom',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            id: 'settings',
            label: 'Settings…',
            accelerator: 'CmdOrCtrl+,',
            click: () => windows.openMain('settings'),
          },
          // Always reachable, so nobody is left signed in with no way out.
          ...(sample
            ? []
            : [
                {
                  id: 'sign-out',
                  label: 'Sign Out',
                  click: () => engine.command('signOut'),
                },
              ]),
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
            id: 'recording-controls',
            label: 'New Recording…',
            accelerator: 'CmdOrCtrl+N',
            click: windows.showPanel,
          },
          {
            id: 'recordings',
            label: 'Recordings',
            accelerator: 'CmdOrCtrl+1',
            click: () => windows.openMain('recordings'),
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
          ...(sample
            ? [
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
              ]
            : []),
          {
            label: sample ? 'About Bloom Preview' : 'About Bloom',
            click: () => app.showAboutPanel(),
          },
          { label: 'Replay Onboarding', click: windows.openOnboarding },
          ...(exportDiagnostics && !sample
            ? [{ label: 'Export Diagnostics…', click: exportDiagnostics }]
            : []),
        ],
      },
    ]),
  );
  const updateAccess = (state) => {
    const menu = Menu.getApplicationMenu?.();
    for (const id of ['settings', 'recordings', 'recording-controls']) {
      const item = menu?.getMenuItemById(id);
      if (item)
        item.enabled =
          id === 'recording-controls'
            ? controlsAvailable(state, prefs.all())
            : setupReady(state, prefs.all());
    }
    const signOut = menu?.getMenuItemById('sign-out');
    if (signOut)
      signOut.enabled =
        state.account?.status === 'signed-in' && canSignOut(state);
  };
  updateAccess(engine.getState());
  return updateAccess;
}

module.exports = { installMenu };
