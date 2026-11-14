// The video on the recording page, its playbar and the timeline under it. The page is
// redrawn from a template on every change, so the <video> element itself is kept and put
// back into the new page: playback carries on through a redraw instead of reloading.
import { clock } from '../shared/dom.js';

const RATES = [1, 1.25, 1.5, 2];
const positions = new Map(); // recording id -> seconds, for when it is opened again
let rate = 1;
let kept = null; // { id, url, video, hls } between a redraw and the next mount
let bound = null; // listeners of the current page, dropped at the next redraw

function drop() {
  if (!kept) return;
  positions.set(kept.id, kept.video.currentTime || 0);
  kept.hls?.destroy();
  kept.video.removeAttribute('src');
  kept.video.load();
  kept = null;
}

// Called before the page is redrawn or closed: the listeners go, the video is held.
export function releasePlayer() {
  bound?.abort();
  bound = null;
  if (kept) positions.set(kept.id, kept.video.currentTime || 0);
}

function load(record, video) {
  const failed = () => {
    const message = document.querySelector('[data-player-error]');
    if (message)
      message.textContent =
        'Playback could not load. Check your connection and refresh the recording.';
  };
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
  video.addEventListener('error', failed);
  let hls = null;
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
  return hls;
}

// Put the video on the page that was just drawn. Without a record, or on a page with no
// player, whatever was playing is let go.
export function mountPlayer(record) {
  const placeholder = document.querySelector('[data-player]');
  if (!placeholder || !record?.streamUrl) return drop();
  if (kept && (kept.id !== record.id || kept.url !== record.streamUrl)) drop();
  let video = placeholder;
  if (kept) {
    video = kept.video;
    placeholder.replaceWith(video); // same element: it keeps playing
  } else {
    kept = { id: record.id, url: record.streamUrl, video, hls: null };
    kept.hls = load(record, video);
  }
  video.playbackRate = rate;
  wire(record, video);
}

// The playbar and the timeline of the page as it now stands.
function wire(record, video) {
  bound = new AbortController();
  const { signal } = bound;
  const box = video.closest('.player');
  const line = document.querySelector('[data-timeline]');
  const time = box?.querySelector('[data-player-time]');
  const speed = box?.querySelector('[data-player-speed]');
  const toggle = box?.querySelector('[data-player-toggle]');
  const total = () =>
    Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : record.duration || 0;

  function paint() {
    const at = video.currentTime || positions.get(record.id) || 0;
    const length = total();
    if (time) time.textContent = `${clock(at)} / ${clock(length)}`;
    box?.classList.toggle('playing', !video.paused && !video.ended);
    if (toggle)
      toggle.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    if (speed) speed.textContent = `${rate}×`;
    if (!line || !length) return;
    line.setAttribute('aria-valuemax', String(Math.round(length)));
    line.setAttribute('aria-valuenow', String(Math.round(at)));
    line.setAttribute('aria-valuetext', `${clock(at)} of ${clock(length)}`);
    line.style.setProperty('--at', `${Math.min(100, (at / length) * 100)}%`);
    // Each chapter fills as the video passes through it.
    for (const part of document.querySelectorAll('[data-from]')) {
      const from = Number(part.dataset.from);
      const to = Number(part.dataset.to) || length;
      const done = Math.max(0, Math.min(1, (at - from) / (to - from || 1)));
      part.style.setProperty('--done', `${done * 100}%`);
      part.classList.toggle('now', at >= from && at < to);
    }
  }
  for (const name of [
    'timeupdate',
    'durationchange',
    'seeked',
    'play',
    'pause',
    'ended',
    'ratechange',
  ])
    video.addEventListener(name, paint, { signal });
  paint();

  const play = () =>
    video.paused ? video.play().catch(() => {}) : video.pause();
  toggle?.addEventListener('click', play, { signal });
  video.addEventListener('click', play, { signal });
  speed?.addEventListener(
    'click',
    () => {
      rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
      video.playbackRate = rate;
    },
    { signal },
  );
  // Full screen shows the video alone, so there it has the system's own controls.
  box
    ?.querySelector('[data-player-full]')
    ?.addEventListener(
      'click',
      () =>
        document.fullscreenElement
          ? document.exitFullscreen()
          : box.requestFullscreen?.().catch(() => {}),
      { signal },
    );
  document.addEventListener(
    'fullscreenchange',
    () => {
      video.controls = document.fullscreenElement === box;
    },
    { signal },
  );

  if (!line) return;
  // Click or drag along the timeline to move through the recording.
  const to = (event) => {
    const { left, width } = line.getBoundingClientRect();
    if (!width || !total()) return;
    video.currentTime =
      Math.max(0, Math.min(1, (event.clientX - left) / width)) * total();
  };
  let dragging = false;
  line.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target.closest('button')) return; // a mark is its own button
      dragging = true;
      line.setPointerCapture(event.pointerId);
      to(event);
    },
    { signal },
  );
  line.addEventListener('pointermove', (event) => dragging && to(event), {
    signal,
  });
  for (const name of ['pointerup', 'pointercancel'])
    line.addEventListener(name, () => (dragging = false), { signal });
  line.addEventListener(
    'keydown',
    (event) => {
      const step = { ArrowLeft: -5, ArrowRight: 5 }[event.key];
      if (!step) return;
      event.preventDefault();
      video.currentTime = Math.max(
        0,
        Math.min(total(), video.currentTime + step),
      );
    },
    { signal },
  );
}

export function seek(seconds) {
  const video = kept?.video;
  if (video && Number.isFinite(seconds) && seconds >= 0)
    video.currentTime = seconds;
}

// Open this recording at a moment: the next time it is mounted it starts there.
export function startAt(recordId, seconds) {
  if (Number.isFinite(seconds) && seconds >= 0)
    positions.set(recordId, seconds);
}
