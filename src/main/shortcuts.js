// Global shortcuts, and the start/stop toggle the record shortcut drives.
const { globalShortcut } = require('electron');
const { setupReady } = require('./access');

function createShortcuts({ engine, windows, notifications, prefs }) {
  // From anywhere: stop a running capture, start one if nothing is in the way, otherwise show why not.
  function toggleCapture() {
    const state = engine.getState();
    const { phase, permissions } = state;
    if (['recording', 'paused'].includes(phase)) {
      engine.command('stop');
      return;
    }
    if (!['idle', 'finished'].includes(phase)) {
      windows.showPanel();
      return;
    }
    if (!setupReady(state, prefs.all())) {
      windows.openOnboarding();
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
