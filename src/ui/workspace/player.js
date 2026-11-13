let hls = null;
const positions = new Map();
let previous = null;

export function releasePlayer() {
  if (previous) positions.set(previous.id, previous.element.currentTime || 0);
  hls?.destroy();
  hls = null;
  previous = null;
}

export function mountPlayer(record) {
  const video = document.querySelector('[data-player]');
  if (!video || !record?.streamUrl) return;
  previous = { id: record.id, element: video };
  video.addEventListener(
    'loadedmetadata',
    () => {
      video.currentTime = Math.min(
        positions.get(record.id) || 0,
        video.duration || 0,
      );
    },
    { once: true },
  );
  const failed = () => {
    const message = document.querySelector('[data-player-error]');
    if (message)
      message.textContent =
        'Playback could not load. Check your connection and refresh the recording.';
  };
  video.addEventListener('error', failed);
  if (video.canPlayType('application/vnd.apple.mpegurl'))
    video.src = record.streamUrl;
  else if (window.Hls?.isSupported()) {
    hls = new window.Hls({ enableWorker: false });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) failed();
    });
    hls.loadSource(record.streamUrl);
    hls.attachMedia(video);
  } else failed();
}

export function seek(seconds) {
  const video = document.querySelector('[data-player]');
  if (video && Number.isFinite(seconds) && seconds >= 0)
    video.currentTime = seconds;
}

// Open this recording at a moment: the next time it is mounted it starts there.
export function startAt(recordId, seconds) {
  if (Number.isFinite(seconds) && seconds >= 0)
    positions.set(recordId, seconds);
}
