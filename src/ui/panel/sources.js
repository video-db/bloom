// What a recording will capture, as one row of icons: display, microphone, system audio.
// An icon turns its source on or off. Where there is a choice (more than one display) a
// small arrow beside the icon opens it. The display is always on.
import { esc } from '../shared/dom.js';
import { icon } from '../shared/icons.js';

// Which chooser is open in this window ('display' or null), and which of its lists shows.
let open = null;
let tab = 'displays'; // 'displays' | 'windows'
export const chooser = {
  toggle(name) {
    open = open === name ? null : name;
  },
  close() {
    open = null;
  },
  show(name) {
    tab = name;
  },
  isOpen: () => open !== null,
};

const chosenWindow = (s) =>
  s.sources.window && s.windows.list.find((w) => w.id === s.sources.window);

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
  const win = chosenWindow(s);
  const name = win
    ? `${win.app} · ${win.title}`
    : displays[index]?.name || 'Display';
  const several = displays.length > 1;
  // With one display and no windows to offer there is nothing to choose.
  const choice = several || s.windows.supported;
  return /* HTML */ `<span class="source on">
    <span
      class="capture-option on"
      role="img"
      aria-label="Recording ${esc(name)}"
      title="${esc(name)}"
    >
      ${icon(win ? 'window' : 'screen')}${
        several && !win
          ? `<span class="display-number">${index + 1}</span>`
          : ''
      }
    </span>
    ${choice && !locked ? arrow('display', 'Choose what to record') : ''}
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

const displayTiles = (s) =>
  /* HTML */ `<div
    class="display-map"
    role="group"
    aria-label="Available displays"
  >
    ${s.channels.displays
      .map((d, index) => {
        const selected = !s.sources.window && d.id === s.sources.screen;
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
  </div>`;

// Open windows, grouped by the app they belong to.
function windowList(s) {
  if (!s.windows.list.length)
    return '<p class="window-none">No windows to record. Open one and look again.</p>';
  const apps = new Map();
  for (const w of s.windows.list)
    apps.set(w.app, [...(apps.get(w.app) || []), w]);
  return [...apps]
    .map(
      ([app, list]) =>
        /* HTML */ `<h4 class="window-app">${esc(app)}</h4>
          ${list
            .map((w) => {
              const selected = w.id === s.sources.window;
              return /* HTML */ `<button
                class="window-row ${selected ? 'selected' : ''}"
                data-pick="window"
                data-id="${esc(w.id)}"
                aria-pressed="${selected}"
                title="${esc(w.title)}"
              >
                <span class="window-tick">${selected ? icon('check') : ''}</span
                ><span class="window-title">${esc(w.title)}</span
                ><small>${w.width}×${w.height}</small>
              </button>`;
            })
            .join('')}`,
    )
    .join('');
}

function displayChoices(s) {
  const windows = s.windows.supported;
  const showing = windows && tab === 'windows' ? 'windows' : 'displays';
  const segment = (name, label) =>
    `<button class="${showing === name ? 'on' : ''}" aria-pressed="${showing === name}" data-source-tab="${name}">${label}</button>`;
  return /* HTML */ `<section
    class="display-choices"
    id="source-chooser"
    aria-label="Choose what to record"
  >
    ${
      windows
        ? `<span class="seg source-tabs" role="group" aria-label="Displays or windows">${segment('displays', 'Displays')}${segment('windows', 'Windows')}</span>`
        : '<div class="display-chooser-heading"><b>Choose a display</b></div>'
    }
    ${
      showing === 'windows'
        ? `<div class="window-list">${windowList(s)}</div>`
        : displayTiles(s)
    }
  </section>`;
}

// locked: a session is running, so the row shows what is being captured and cannot change.
export function sources(s, { locked = false } = {}) {
  if (locked) open = null;
  // A chooser whose choice has gone (a display unplugged) closes itself.
  if (
    open === 'display' &&
    s.channels.displays.length < 2 &&
    !s.windows.supported
  )
    open = null;
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
    ${
      chosenWindow(s)
        ? `<p class="source-what">Window · <b>${esc(chosenWindow(s).app)} · ${esc(chosenWindow(s).title)}</b></p>`
        : ''
    }
    ${open === 'display' ? displayChoices(s) : ''}
  </div>`;
}
