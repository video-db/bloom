// The windows that float over the person's work while recording (ADR 0005): for now, the
// recording control. They never take focus from the app being recorded, stay above other
// windows, and are shown only where they cannot end up in the recording.
const { safeDisplay, placeOn } = require('./float-placement');

const CONTROL = { width: 56, height: 220 };

function createFloating({ screen, surface, prefs, isQuitting }) {
  let control = null;
  const alive = (window) => !!window && !window.isDestroyed();

  function createControl() {
    control = surface('control', {
      ...CONTROL,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false, // a click acts without taking the keyboard from the recorded app
      alwaysOnTop: true,
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    });
    control.setAlwaysOnTop(true, 'floating');
    // As the tray panel does: over fullscreen apps without hiding Bloom's Dock icon.
    control.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    // Honoured by older capture paths; not by ScreenCaptureKit, hence the placement rule.
    control.setContentProtection(true);
    control.on('moved', () => {
      const [x, y] = control.getPosition();
      prefs.set('floatAt', { x, y });
    });
    control.on('close', (event) => {
      if (!isQuitting()) {
        event.preventDefault();
        control.hide();
      }
    });
  }

  return {
    // Called with every state change: show, place or hide the control.
    sync(state) {
      const wanted =
        prefs.all().floatingControl &&
        ['recording', 'paused'].includes(state.phase) &&
        safeDisplay(state, screen.getAllDisplays(), screen.getPrimaryDisplay());
      if (!wanted) {
        if (alive(control) && control.isVisible()) control.hide();
        return;
      }
      if (!alive(control)) createControl();
      if (!control.isVisible()) {
        const [width, height] = control.getSize();
        const at = placeOn(wanted, { width, height }, prefs.all().floatAt);
        control.setPosition(at.x, at.y);
        control.showInactive();
      }
    },
    // The control says how tall its buttons are; the window follows.
    resize(height) {
      if (alive(control) && Number.isFinite(height))
        control.setSize(
          CONTROL.width,
          Math.max(120, Math.min(420, Math.round(height))),
        );
    },
    roleOf: (window) =>
      alive(control) && window === control ? 'control' : null,
    send(channel, payload) {
      if (alive(control)) control.webContents.send(channel, payload);
    },
    isShowing: () => alive(control) && control.isVisible(),
    dispose() {
      if (alive(control)) control.destroy();
      control = null;
    },
  };
}

module.exports = { createFloating };
