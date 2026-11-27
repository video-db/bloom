// The video on the recording page, its playbar and the timeline under it. The page is
// redrawn from a template on every change, so the <video> element itself is kept and put
// back into the new page: playback carries on through a redraw instead of reloading.
import { clock } from '../shared/dom.js';
import { remap } from './versions.js';

const RATES = [1, 1.25, 1.5, 2];
const positions = new Map(); // recording id -> seconds, for when it is opened again
let rate = 1;
let kept = null; // { id, url, video, hls, ready } between a redraw and the next mount
let bound = null; // listeners of the current page, dropped at the next redraw
let cuts = []; // what the version being played left out of the original, if it is one
let lead = 0; // seconds of opening card before the recording begins in that version

// Remember where the video is for the next time it is opened. Before it has loaded there
// is nothing to remember (and a place asked for must not be lost); after it has ended, the
// next time starts from the beginning.
function remember() {
  if (!kept?.ready) return;
  positions.set(kept.id, kept.video.ended ? 0 : kept.video.currentTime || 0);
}

function drop() {
  if (!kept) return;
  remember();
  kept.hls?.destroy();
  kept.video.removeAttribute('src');
  kept.video.load();
  kept = null;
}

// Called before the page is redrawn or closed: the listeners go, the video is held.
export function releasePlayer() {
  bound?.abort();
  bound = null;
  remember();
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
      if (kept?.video === video) kept.ready = true;
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
  cuts = record?.cuts || [];
  lead = record?.lead || 0;
  if (!placeholder || !record?.streamUrl) return drop();
  if (kept && (kept.id !== record.id || kept.url !== record.streamUrl)) drop();
  let video = placeholder;
  if (kept) {
    video = kept.video;
    placeholder.replaceWith(video); // same element: it keeps playing
  } else {
    kept = {
      id: record.id,
      url: record.streamUrl,
      video,
      hls: null,
      ready: false,
    };
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
    // At the very start, Make shows the chosen title over the picture as a preview.
    box?.classList.toggle('at-start', at < 2.5);
    if (toggle)
      toggle.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    if (speed) speed.textContent = `${rate}×`;
    if (!line || !length) return;
    line.setAttribute('aria-valuemax', String(Math.round(length)));
    line.setAttribute('aria-valuenow', String(Math.round(at)));
    line.setAttribute('aria-valuetext', `${clock(at)} of ${clock(length)}`);
    line.style.setProperty('--at', `${Math.min(100, (at / length) * 100)}%`);
    // The timeline follows the video's real length, which the recording's stored length
    // can differ from: the last chapter ends where the video does, and marks sit by it.
    const all = [...document.querySelectorAll('.tl-part')];
    for (const part of document.querySelectorAll('[data-from]')) {
      const from = Number(part.dataset.from);
      const last = part.dataset.to === all.at(-1)?.dataset.to;
      const to = last ? Math.max(length, from + 1) : Number(part.dataset.to);
      part.style.flexGrow = String(Math.max(to - from, 0.001));
      const done = Math.max(0, Math.min(1, (at - from) / (to - from || 1)));
      part.style.setProperty('--done', `${done * 100}%`);
      part.classList.toggle('now', at >= from && (last || at < to));
    }
    for (const mark of line.querySelectorAll('.tl-mark'))
      mark.style.left = `${Math.min(100, (Number(mark.dataset.at) / length) * 100)}%`;
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
  // In full screen the system's own controls play and pause; handling the click here too
  // would undo it.
  video.addEventListener(
    'click',
    () => document.fullscreenElement !== video && play(),
    { signal },
  );
  speed?.addEventListener(
    'click',
    () => {
      rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
      video.playbackRate = rate;
    },
    { signal },
  );
  // Full screen is the video itself, with the system's own controls: their pause and
  // full-screen buttons act on the video, so they work and lead back to the page.
  box
    ?.querySelector('[data-player-full]')
    ?.addEventListener(
      'click',
      () =>
        document.fullscreenElement
          ? document.exitFullscreen()
          : video.requestFullscreen?.().catch(() => {}),
      { signal },
    );
  document.addEventListener(
    'fullscreenchange',
    () => {
      video.controls = document.fullscreenElement === video;
    },
    { signal },
  );

  // Marks and chapter names under the video jump to their moment of what is playing.
  video.closest('.watch-video')?.addEventListener(
    'click',
    (event) => {
      const at = event.target.closest('[data-at]')?.dataset.at;
      if (at !== undefined) seekPlaying(Number(at));
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
      if (event.target !== line) return; // a mark on the timeline has its own keys
      const to = {
        ArrowLeft: video.currentTime - 5,
        ArrowRight: video.currentTime + 5,
        Home: 0,
        End: total(),
      }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      video.currentTime = Math.max(0, Math.min(total(), to));
    },
    { signal },
  );
}

// Move what is playing to one of its own moments.
function seekPlaying(seconds) {
  if (!kept || !Number.isFinite(seconds) || seconds < 0) return;
  // Before the video has loaded, the place is kept for when it has.
  if (kept.ready) kept.video.currentTime = seconds;
  else positions.set(kept.id, seconds);
}

// Move to a moment of the original recording, wherever that now is in what is playing.
export function seek(seconds) {
  if (Number.isFinite(seconds)) seekPlaying(remap(seconds, cuts, lead));
}

// Open this recording at a moment: the next time it is mounted it starts there.
export function startAt(recordId, seconds) {
  if (Number.isFinite(seconds) && seconds >= 0)
    positions.set(recordId, seconds);
}
