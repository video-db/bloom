// The floating camera: a round, mirrored picture of the camera that sits on screen while
// the camera is on. It is moved by dragging and has three sizes that show under the pointer.
// The picture is only shown here; nothing is recorded or sent by this window.
const SIZES = [
  ['s', 'Small'],
  ['m', 'Medium'],
  ['l', 'Large'],
];

export function mountCamera(root) {
  // Automated runs draw the bubble without opening the real camera.
  const still = location.hash === '#still';
  root.innerHTML = /* HTML */ `<div class="cam">
    <video autoplay muted playsinline></video>
    <p class="cam-note" role="status" hidden></p>
    <div class="cam-sizes" role="group" aria-label="Camera size">
      ${SIZES.map(
        ([key, name]) =>
          `<button data-size="${key}" aria-label="${name}" title="${name}"></button>`,
      ).join('')}
    </div>
  </div>`;
  const bubble = root.querySelector('.cam');
  const note = root.querySelector('.cam-note');
  const say = (text) => {
    note.textContent = text;
    note.hidden = false;
  };
  let stream = null;
  if (still) say('Camera');
  else
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((media) => {
        stream = media;
        // Unplugged, or taken by something else.
        media
          .getVideoTracks()[0]
          ?.addEventListener('ended', () =>
            say('The camera stopped. Turn it off and on again.'),
          );
        root.querySelector('video').srcObject = media;
      })
      .catch(() => say('The camera could not be opened.'));
  window.addEventListener('beforeunload', () =>
    stream?.getTracks().forEach((track) => track.stop()),
  );

  // Dragging moves the window. A drag region would swallow the pointer, and with it the
  // size buttons, so the movement is reported and the main process moves the window.
  let last = null;
  bubble.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    last = { x: event.screenX, y: event.screenY };
    bubble.setPointerCapture(event.pointerId);
  });
  bubble.addEventListener('pointermove', (event) => {
    if (!last) return;
    window.bloom.ui('camera-drag', {
      dx: event.screenX - last.x,
      dy: event.screenY - last.y,
    });
    last = { x: event.screenX, y: event.screenY };
  });
  const drop = () => {
    if (last) window.bloom.ui('camera-drop');
    last = null;
  };
  bubble.addEventListener('pointerup', drop);
  bubble.addEventListener('pointercancel', drop);
  root.addEventListener('click', (event) => {
    const size = event.target.closest('[data-size]')?.dataset.size;
    if (size) window.bloom.ui('camera-size', { size });
  });

  return {
    receive(state) {
      for (const button of root.querySelectorAll('[data-size]'))
        button.classList.toggle(
          'on',
          button.dataset.size === state.prefs.camSize,
        );
    },
  };
}
