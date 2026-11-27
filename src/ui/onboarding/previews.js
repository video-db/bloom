// Proof that a permission works: a small live view of the screen and the microphone's
// level. Both stay in this window; nothing is recorded or sent. If either cannot run,
// the row keeps its plain tick.
const BARS = 5;

export function createPreviews() {
  let screenTimer = null;
  let screenImage = ''; // last frame, so a re-render does not flash back to the tick
  let meter = null; // { stream, audio, frame }

  async function drawScreen(root) {
    const slot = root.querySelector('[data-preview="screen"]');
    if (!slot) return;
    const frame = await window.bloom.screenPreview().catch(() => null);
    if (frame) screenImage = frame;
    paintScreen(root);
  }
  function paintScreen(root) {
    const slot = root.querySelector('[data-preview="screen"]');
    if (!slot || !screenImage) return;
    let image = slot.querySelector('img');
    if (!image) {
      slot.classList.add('live');
      slot.innerHTML = '<img alt="" /><em>Live</em>';
      image = slot.querySelector('img');
    }
    image.src = screenImage;
  }

  async function startMeter() {
    if (meter) return;
    meter = {}; // claimed before the first await so two renders cannot both start it
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 64;
      audio.createMediaStreamSource(stream).connect(analyser);
      const levels = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(levels);
        document
          .querySelectorAll('[data-preview="mic"] i')
          .forEach((bar, index) => {
            const level = levels[2 + index * 3] / 255;
            bar.style.transform = `scaleY(${Math.max(0.18, level)})`;
          });
        meter.frame = requestAnimationFrame(tick);
      };
      Object.assign(meter, { stream, audio });
      tick();
    } catch {
      meter = { failed: true }; // the row keeps its tick
    }
  }
  function paintMeter(root) {
    const slot = root.querySelector('[data-preview="mic"]');
    if (!slot || !meter?.stream || slot.classList.contains('live')) return;
    slot.classList.add('live');
    slot.innerHTML = '<i></i>'.repeat(BARS);
  }
  function stopMeter() {
    if (!meter) return;
    cancelAnimationFrame(meter.frame);
    meter.stream?.getTracks().forEach((track) => track.stop());
    meter.audio?.close();
    meter = null;
  }
  function stopScreen() {
    clearInterval(screenTimer);
    screenTimer = null;
  }

  return {
    // Call after every render of the permissions step.
    sync(root, { screen, mic }) {
      if (screen) {
        paintScreen(root);
        if (!screenTimer) {
          drawScreen(root);
          screenTimer = setInterval(() => drawScreen(root), 2000);
        }
      } else stopScreen();
      if (mic) startMeter().then(() => paintMeter(root));
      else stopMeter();
      paintMeter(root);
    },
    stop() {
      stopScreen();
      stopMeter();
    },
  };
}
