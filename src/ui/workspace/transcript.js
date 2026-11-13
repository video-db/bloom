// The transcript as something to read: the engine's paragraphs, each starting with its
// time. Clicking a time plays from there.
import { esc, clock } from '../shared/dom.js';

// What the reading column says when there is no transcript text to show.
const WAITING = {
  processing: 'Preparing the transcript…',
  error: 'The transcript could not be loaded.',
  empty:
    'No transcript text is available yet. This does not confirm there was no speech.',
};

function body(r) {
  if (!r.transcript)
    return `<p class="reading-empty">${WAITING[r.transcriptStatus] || 'No transcript yet.'}</p>`;
  const paras = r.paragraphs || [];
  // A transcript read before paragraphs were kept has only its text.
  if (!paras.length) return `<p class="para">${esc(r.transcript)}</p>`;
  return paras
    .map(
      ({ at, text }) =>
        `<p class="para"><button class="ts" data-seek="${at}" title="Play from ${clock(at)}">${clock(at)}</button>${esc(text)}</p>`,
    )
    .join('');
}

export const transcript = (r) =>
  /* HTML */ `<section class="reading" aria-label="Transcript">
    <div id="transcript" tabindex="0">${body(r)}</div>
  </section>`;
