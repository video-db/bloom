// The tray icon is the status light: its image, animation and title follow the capture phase.
const path = require('node:path');
const { Tray, nativeImage } = require('electron');
const { clock } = require('./clock');

// What the title says while a stopped recording is on its way to VideoDB.
function savingLabel(upload) {
  if (upload?.stage === 'uploading')
    return `Uploading ${Math.round(upload.progress * 100)}%`;
  return upload?.stage === 'processing' ? 'Processing' : 'Saving';
}

function createTray({ assets }) {
  const img = (file) =>
    nativeImage.createFromPath(path.join(assets, 'tray', file));
  const frames = (dir, count, suffix) =>
    Array.from({ length: count }, (_, i) =>
      img(`${dir}/bloom-${dir}-${String(i).padStart(2, '0')}${suffix}.png`),
    );

  let tray = null;
  const listeners = new Set();
  const recFrames = frames('recording', 12, '');
  const busyFrames = frames('busy', 8, 'Template');
  let timer = null,
    frame = 0,
    key = '',
    reducedMotion = false;

  function animate(set, ms) {
    clearInterval(timer);
    frame = 0;
    tray.setImage(set[0]);
    if (reducedMotion) return;
    timer = setInterval(() => {
      frame = (frame + 1) % set.length;
      tray.setImage(set[frame]);
    }, ms);
  }

  function paint(state) {
    if (!tray) return;
    // The image only changes with the phase; the title below changes every second.
    const next = `${state.phase}:${!!state.problem}:${reducedMotion}`;
    if (next !== key) {
      key = next;
      clearInterval(timer);
      timer = null;
      if (state.phase === 'recording') animate(recFrames, 130);
      else if (state.phase === 'starting' || state.phase === 'saving')
        animate(busyFrames, 140);
      else if (state.phase === 'paused')
        tray.setImage(img('bloom-pausedTemplate.png'));
      else if (
        state.phase === 'stopped' ||
        state.phase === 'processing-error' ||
        state.problem
      )
        tray.setImage(img('bloom-warning.png'));
      else tray.setImage(img('bloomTemplate.png'));
    }
    const title =
      {
        starting: ' Starting',
        recording: ` ${clock(state.elapsed)}${state.ask ? '  Stop?' : ''}`,
        paused: ` ${clock(state.elapsed)}`,
        saving: ` ${savingLabel(state.upload)}`,
      }[state.phase] || '';
    tray.setTitle(title, { fontType: 'monospacedDigit' });
    tray.setToolTip(
      state.phase === 'recording' ? 'Bloom is recording' : 'Bloom',
    );
  }

  return {
    setAvailable(available) {
      if (available && !tray) {
        tray = new Tray(img('bloomTemplate.png'));
        key = '';
        for (const listener of listeners) {
          tray.on('click', listener);
          tray.on('right-click', listener);
        }
      } else if (!available && tray) {
        clearInterval(timer);
        timer = null;
        tray.destroy();
        tray = null;
        key = '';
      }
    },
    isAvailable: () => tray !== null,
    paint,
    // Takes effect on the next paint.
    setReducedMotion(value) {
      reducedMotion = value;
    },
    getBounds: () => tray?.getBounds() || { x: 0, y: 0, width: 0, height: 0 },
    onClick(listener) {
      listeners.add(listener);
      tray?.on('click', listener);
      tray?.on('right-click', listener);
    },
    dispose() {
      clearInterval(timer);
      tray?.destroy?.();
      tray = null;
      listeners.clear();
    },
  };
}

module.exports = { createTray };
