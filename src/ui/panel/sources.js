// What a recording will capture, as one row of icons: display, microphone, system audio.
// An icon turns its source on or off. Where there is a choice (more than one display) a
// small arrow beside the icon opens it. The display is always on.
import { esc } from '../shared/dom.js';
import { icon } from '../shared/icons.js';

// Which chooser is open in this window: 'display' or null.
let open = null;
export const chooser = {
  toggle(name) {
    open = open === name ? null : name;
  },
  close() {
    open = null;
  },
};

const arrow = (name, label) =>
  /* HTML */ `<button
    class="source-arrow ${open === name ? 'open' : ''}"
    data-chooser="${name}"
    aria-expanded="${open === name}"
    aria-controls="source-chooser"
    aria-label="${label}"
    title="${label}"
  >
    ${icon('down')}
  </button>`;

function display(s, locked) {
  const { displays } = s.channels;
  const index = Math.max(
    0,
    displays.findIndex((d) => d.id === s.sources.screen),
  );
  const name = displays[index]?.name || 'Display';
  const several = displays.length > 1;
  // With one display there is nothing to choose, so the icon is a plain indicator.
  return /* HTML */ `<span class="source on">
    <span
      class="capture-option on"
      role="img"
      aria-label="Recording ${esc(name)}"
      title="${esc(name)}"
    >
      ${icon('screen')}${
        several ? `<span class="display-number">${index + 1}</span>` : ''
      }
    </span>
    ${several && !locked ? arrow('display', 'Choose a display') : ''}
  </span>`;
}

function toggle({ key, glyph, label, on, detail = '', locked = false }) {
  const state = on ? 'On' : 'Off';
  return /* HTML */ `<button
    class="capture-option ${on ? 'on' : ''}"
    ${
      locked
        ? 'disabled'
        : `data-command="setSource" data-key="${key}" data-value="${!on}"`
    }
    aria-pressed="${on}"
    aria-label="${label}: ${state}"
    title="${esc(detail || label)}: ${state}"
  >
    ${icon(glyph)}${on ? '' : '<span class="source-slash"></span>'}
  </button>`;
}

// Recording uses the Mac's default microphone, so there is nothing to choose: on or off.
function microphone(s, locked) {
  return /* HTML */ `<span class="source ${s.sources.mic ? 'on' : ''}">
    ${toggle({
      key: 'mic',
      glyph: 'microphone',
      label: 'Microphone',
      on: s.sources.mic,
      locked,
    })}
  </span>`;
}

function displayChoices(s) {
  return /* HTML */ `<section
    class="display-choices"
    id="source-chooser"
    aria-label="Choose a display"
  >
    <div class="display-chooser-heading"><b>Choose a display</b></div>
    <div class="display-map" role="group" aria-label="Available displays">
      ${s.channels.displays
        .map((d, index) => {
          const selected = d.id === s.sources.screen;
          return /* HTML */ `<button
            class="display-tile ${selected ? 'selected' : ''}"
            data-pick="screen"
            data-id="${esc(d.id)}"
            aria-pressed="${selected}"
          >
            <span class="mini-desktop"
              ><span>${index + 1}</span>${selected ? '<i>✓</i>' : ''}</span
            >
            <b>${esc(d.name)}</b>
          </button>`;
        })
        .join('')}
    </div>
  </section>`;
}

// locked: a session is running, so the row shows what is being captured and cannot change.
export function sources(s, { locked = false } = {}) {
  if (locked) open = null;
  // A chooser whose choice has gone (a display unplugged) closes itself.
  if (open === 'display' && s.channels.displays.length < 2) open = null;
  const systemAudio = toggle({
    key: 'systemAudio',
    glyph: 'audio',
    label: 'System audio',
    on: s.sources.systemAudio,
    locked,
  });
  return /* HTML */ `<div class="source-group">
    <div class="capture-options" role="group" aria-label="Capture sources">
      ${display(s, locked)}<span class="source-divider"></span>${microphone(
        s,
        locked,
      )}${systemAudio}
    </div>
    ${open === 'display' ? displayChoices(s) : ''}
  </div>`;
}
