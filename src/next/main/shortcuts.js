// Global shortcuts, and the start/stop toggle the record shortcut drives.
const { globalShortcut } = require('electron');

function createShortcuts({ engine, windows, notifications }) {
  // From anywhere: stop a running capture, start one if nothing is in the way, otherwise show why not.
  function toggleCapture() {
    const { phase, permissions } = engine.getState();
    if (['recording', 'paused'].includes(phase)) {
      engine.command('stop');
      return;
    }
    if (!['idle', 'finished'].includes(phase)) {
      windows.showPanel();
      return;
    }
    if (!permissions.screen) {
      windows.showPanel();
      notifications.screenPermissionNeeded();
      return;
    }
    engine.command('start');
  }

  return {
    toggleCapture,
    register() {
      globalShortcut.register('CommandOrControl+Shift+R', toggleCapture);
      globalShortcut.register('CommandOrControl+Shift+M', () =>
        engine.command('mark'),
      );
    },
    unregister() {
      globalShortcut.unregisterAll();
    },
  };
}

module.exports = { createShortcuts };
