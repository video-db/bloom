// The floating recording control: a small capsule of round buttons, on the left edge like
// Loom's. Stop with the running time, pause or resume, mark, each sound source on its own,
// and hiding the window when a window is being recorded.
import { clock } from '../shared/dom.js';
import { icon } from '../shared/icons.js';

const round = ({ command, label, glyph, attrs = '', off = false, kind = '' }) =>
  /* HTML */ `<button
    class="fb nodrag ${kind} ${off ? 'off' : ''}"
    data-command="${command}"
    ${attrs}
    aria-label="${label}"
    title="${label}"
  >
    ${icon(glyph)}${off ? '<span class="fb-slash"></span>' : ''}
  </button>`;

const mute = (s, key, glyph, name) =>
  s.sources[key]
    ? round({
        command: 'setMuted',
        attrs: `data-key="${key}" data-value="${!s.muted[key]}" aria-pressed="${!s.muted[key]}"`,
        label: s.muted[key] ? `Unmute ${name}` : `Mute ${name}`,
        glyph,
        off: s.muted[key],
      })
    : '';

export function control(s) {
  const paused = s.phase === 'paused';
  return /* HTML */ `<div class="float drag ${paused ? 'paused' : ''}">
    ${round({ command: 'stop', label: 'Stop recording', glyph: 'stop', kind: 'stop' })}
    <span class="float-time" data-clock aria-label="Recorded so far"
      >${clock(s.elapsed)}</span
    >
    ${round(
      paused
        ? { command: 'resume', label: 'Resume', glyph: 'play' }
        : { command: 'pause', label: 'Pause', glyph: 'pause' },
    )}
    ${round({ command: 'mark', label: 'Mark this moment', glyph: 'mark' })}
    ${mute(s, 'mic', 'microphone', 'microphone')}${mute(
      s,
      'systemAudio',
      'audio',
      'system audio',
    )}
    ${
      s.sources.window
        ? round({
            command: 'setWindowHidden',
            attrs: `data-flag="${!s.windowHidden}" aria-pressed="${!s.windowHidden}"`,
            label: s.windowHidden ? 'Show window' : 'Hide window',
            glyph: 'window',
            off: s.windowHidden,
          })
        : ''
    }
  </div>`;
}
