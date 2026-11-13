// What a recording will capture, as one row of icons: display, microphone, system audio.
// An icon turns its source on or off. Where there is a choice (more than one display or
// microphone) a small arrow beside the icon opens it. The display is always on.
import { esc } from './dom.js';
import { icon } from './icons.js';

// Which chooser is open in this window: 'display', 'microphone' or null.
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

function display(s) {
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
    ${several ? arrow('display', 'Choose a display') : ''}
  </span>`;
}

function toggle({ key, glyph, label, on, detail = '' }) {
  const state = on ? 'On' : 'Off';
  return /* HTML */ `<button
    class="capture-option ${on ? 'on' : ''}"
    data-command="setSource"
    data-key="${key}"
    data-value="${!on}"
    aria-pressed="${on}"
    aria-label="${label}: ${state}"
    title="${esc(detail || label)}: ${state}"
  >
    ${icon(glyph)}${on ? '' : '<span class="source-slash"></span>'}
  </button>`;
}

function microphone(s) {
  const { mics } = s.channels;
  const current = mics.find((m) => m.id === s.sources.microphone);
  return /* HTML */ `<span class="source ${s.sources.mic ? 'on' : ''}">
    ${toggle({
      key: 'mic',
      glyph: 'microphone',
      label: 'Microphone',
      on: s.sources.mic,
      detail: current?.name,
    })}
    ${mics.length > 1 ? arrow('microphone', 'Choose a microphone') : ''}
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

function microphoneChoices(s) {
  return /* HTML */ `<section
    class="source-list"
    id="source-chooser"
    aria-label="Choose a microphone"
  >
    <h4>Microphone</h4>
    ${s.channels.mics
      .map((m) => {
        const selected = m.id === s.sources.microphone;
        return /* HTML */ `<button
          class="source-choice ${selected ? 'selected' : ''}"
          data-pick="microphone"
          data-id="${esc(m.id)}"
          aria-pressed="${selected}"
        >
          <span class="source-tick">${selected ? icon('check') : ''}</span
          >${esc(m.name)}
        </button>`;
      })
      .join('')}
  </section>`;
}

export function sources(s) {
  // A chooser whose choice has gone (a display unplugged) closes itself.
  if (open === 'display' && s.channels.displays.length < 2) open = null;
  if (open === 'microphone' && s.channels.mics.length < 2) open = null;
  return /* HTML */ `<div class="source-group">
    <div class="capture-options" role="group" aria-label="Capture sources">
      ${display(s)}<span class="source-divider"></span>${microphone(s)}${toggle(
        {
          key: 'systemAudio',
          glyph: 'audio',
          label: 'System audio',
          on: s.sources.systemAudio,
        },
      )}
    </div>
    ${
      open === 'display'
        ? displayChoices(s)
        : open === 'microphone'
          ? microphoneChoices(s)
          : ''
    }
  </div>`;
}
