// The title bar: what Bloom is capturing right now, and the way to start a recording.
// Working in the app never hides that the screen is being captured.
import { clock, logo } from '../shared/dom.js';

const capture = {
  starting: () => '<span class="badge">Starting…</span>',
  recording: (s) =>
    `<span class="badge rec"><b class="mono" data-clock>${clock(s.elapsed)}</b> · <button data-command="stop">Stop</button></span>`,
  paused: () =>
    '<span class="badge warn">Paused · <button data-command="resume">Resume</button></span>',
  stopping: () => '<span class="badge">Stopping…</span>',
  stopped: () =>
    '<span class="badge warn">Capture needs attention · <button data-ui="show-panel">Review</button></span>',
  saving: () => '<span class="badge">Saving…</span>',
  'processing-error': () =>
    '<span class="badge warn">Saving needs attention · <button data-ui="show-panel">Review</button></span>',
};

// No brand beside the window buttons: the one branded thing here is the action.
export const titleBar = (s) =>
  /* HTML */ `<header class="bar drag">
    <span class="right nodrag">${capture[s.phase]?.(s) || ''}</span>
    <button
      class="btn pri capture-start bar-record nodrag"
      data-ui="show-panel"
    >
      ${logo}<span>New recording</span>
    </button>
  </header>`;
