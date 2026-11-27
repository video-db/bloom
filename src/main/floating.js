// The windows that float over the person's work (ADR 0005): the recording control and the
// camera picture. Neither takes focus from the app being recorded and both stay above other
// windows. The control is shown only where it cannot end up in the recording; the camera
// picture is meant to be seen, so on a display recording it is part of it.
const {
  safeDisplay,
  cameraDisplay,
  placeOn,
  whole,
} = require('./float-placement');

const CONTROL = { width: 56, height: 220 };
const CAMERA = { s: 140, m: 200, l: 280 }; // the round picture's width and height

function createFloating({
  screen,
  surface,
  prefs,
  isQuitting,
  still = false, // automated runs: draw the camera picture without opening the camera
  allowCamera = async () => true, // asks macOS for the camera; false when refused
  cameraRefused = () => {},
}) {
  let control = null;
  let camera = null;
  let asking = false; // macOS is being asked for the camera
  let latest = null; // the newest state, for when that answer comes back
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

  const cameraSize = () => CAMERA[prefs.all().camSize] || CAMERA.m;
  function createCamera() {
    const side = cameraSize();
    camera = surface(
      'camera',
      {
        width: side,
        height: side,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        focusable: false,
        alwaysOnTop: true,
        ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      },
      still ? { hash: 'still' } : {},
    );
    camera.setAlwaysOnTop(true, 'floating');
    camera.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    // Not hidden from capture: on a display recording the picture is meant to be seen.
  }
  const cameraWanted = (state) =>
    !!state?.sources.camera && state.account?.status === 'signed-in';
  function showCamera(state) {
    createCamera();
    const display = cameraDisplay(
      state,
      screen.getAllDisplays(),
      screen.getPrimaryDisplay(),
    );
    const side = cameraSize();
    if (display) {
      const at = placeOn(
        display,
        { width: side, height: side },
        prefs.all().camAt,
        true,
      );
      camera.setPosition(at.x, at.y);
    }
    camera.showInactive();
  }
  // Show or remove the camera picture. Closing the window is what releases the camera.
  function syncCamera(state) {
    latest = state;
    if (!cameraWanted(state)) {
      if (alive(camera)) camera.destroy();
      camera = null;
      return;
    }
    if (alive(camera) || asking) return;
    asking = true;
    Promise.resolve()
      .then(allowCamera)
      .catch(() => false)
      .then((allowed) => {
        asking = false;
        if (isQuitting()) return;
        if (!allowed) {
          if (cameraWanted(latest)) cameraRefused();
          return;
        }
        // It may have been turned off again while macOS was asking.
        if (cameraWanted(latest) && !alive(camera)) showCamera(latest);
      });
  }

  return {
    // Called with every state change: show, place or hide the control and the camera.
    sync(state) {
      syncCamera(state);
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
    // A display was added, removed or changed. The control is placed afresh, since where
    // it stood may now be the display being recorded; the camera is brought back if the
    // display it was on has gone.
    displaysChanged(state) {
      if (alive(control) && control.isVisible()) control.hide();
      if (alive(camera)) {
        const at = camera.getBounds();
        const visible = screen.getAllDisplays().some(({ workArea: area }) => {
          const x = Math.max(at.x, area.x);
          const y = Math.max(at.y, area.y);
          return (
            Math.min(at.x + at.width, area.x + area.width) - x > 40 &&
            Math.min(at.y + at.height, area.y + area.height) - y > 40
          );
        });
        if (!visible) {
          camera.destroy();
          camera = null;
        }
      }
      this.sync(state);
    },
    // The control says how tall its buttons are; the window follows.
    resize(height) {
      if (alive(control) && Number.isFinite(height))
        control.setSize(
          CONTROL.width,
          Math.max(120, Math.min(420, Math.round(height))),
        );
    },
    // The camera picture follows the pointer while it is dragged, then remembers its place.
    dragCamera(dx, dy) {
      if (!alive(camera) || !Number.isFinite(dx) || !Number.isFinite(dy))
        return;
      const [x, y] = camera.getPosition();
      camera.setPosition(whole(x + dx), whole(y + dy));
    },
    dropCamera() {
      if (!alive(camera)) return;
      const [x, y] = camera.getPosition();
      prefs.set('camAt', { x, y });
    },
    // A new size keeps the picture's bottom-left corner where it is, as far as its display
    // allows. True when the size changed.
    resizeCamera(size) {
      if (!CAMERA[size] || !prefs.set('camSize', size)) return false;
      if (!alive(camera)) return true;
      const side = CAMERA[size];
      const was = camera.getBounds();
      const area = screen.getDisplayMatching(was).workArea;
      const within = (value, from, length) =>
        Math.max(from, Math.min(value, from + length - side));
      camera.setBounds({
        x: whole(within(was.x, area.x, area.width)),
        y: whole(within(was.y + was.height - side, area.y, area.height)),
        width: side,
        height: side,
      });
      this.dropCamera();
      return true;
    },
    roleOf: (window) =>
      alive(control) && window === control
        ? 'control'
        : alive(camera) && window === camera
          ? 'camera'
          : null,
    // The camera window is told its size and nothing about the account or recordings.
    cameraState: () => ({ prefs: { camSize: prefs.all().camSize } }),
    send(channel, payload) {
      if (alive(control)) control.webContents.send(channel, payload);
      if (alive(camera))
        camera.webContents.send(
          channel,
          channel === 'bloom:state' ? this.cameraState() : payload,
        );
    },
    isShowing: () => alive(control) && control.isVisible(),
    cameraShowing: () => alive(camera) && camera.isVisible(),
    dispose() {
      for (const window of [control, camera])
        if (alive(window)) window.destroy();
      control = null;
      camera = null;
    },
  };
}

module.exports = { createFloating };
