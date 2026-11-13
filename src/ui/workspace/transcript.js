// The transcript as something to read: paragraphs that follow the speaker's pauses, each
// starting with its time. Clicking a time plays from there.
import { esc, clock } from '../shared/dom.js';

const PAUSE = 1.5; // seconds of silence that start a new paragraph
const LONG = 60; // words after which the next sentence end starts one
const SENTENCE_END = /[.!?…]["')\]]?$/;

// words: [{ word, start, end }] in order -> [{ at, text }]
export function paragraphs(words) {
  const out = [];
  let current = null;
  let previous = null;
  for (const w of words) {
    const paused = previous && w.start - previous.end >= PAUSE;
    const long =
      current && current.count >= LONG && SENTENCE_END.test(previous.word);
    if (!current || paused || long) {
      current = { at: w.start, parts: [], count: 0 };
      out.push(current);
    }
    current.parts.push(w.word);
    current.count += 1;
    previous = w;
  }
  return out.map(({ at, parts }) => ({ at, text: parts.join(' ') }));
}

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
  const paras = paragraphs(r.words || []);
  // Word timings are only held while the recording is open; without them, show the text.
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
    <h2 class="label">Transcript</h2>
    <div id="transcript" tabindex="0">${body(r)}</div>
  </section>`;
