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

// What to do about a recording with no transcript: say why, or offer to make one. Used
// by the Transcript and Summary tabs.
export function withoutTranscript(r, signedIn) {
  const unavailable = !r.videoId || !signedIn ? 'disabled' : '';
  if (r.transcriptStatus === 'processing')
    return `<p class="reading-empty" role="status">${WAITING.processing}</p>`;
  // A video from another collection is read as it is; Bloom does not transcribe it.
  if (r.readOnly) return '<p class="reading-empty">Not transcribed.</p>';
  if (r.transcriptStatus === 'error' || r.transcriptRequested)
    return /* HTML */ `<p class="reading-empty" role="alert">
      ${WAITING.error}
      <button
        class="page-link"
        data-command="openRecording"
        data-id="${esc(r.id)}"
        ${unavailable}
      >
        Try again
      </button>
    </p>`;
  return /* HTML */ `<p class="reading-empty">
      ${WAITING[r.transcriptStatus] || 'No transcript yet.'}
    </p>
    <p class="reading-empty">
      <button
        class="btn sm"
        data-command="requestTranscript"
        data-id="${esc(r.id)}"
        ${unavailable}
      >
        Add transcript
      </button>
    </p>
    <p class="caption">Preparing a transcript may use VideoDB credits.</p>`;
}

function body(r, signedIn) {
  if (!r.transcript) return withoutTranscript(r, signedIn);
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

export const transcript = (r, signedIn) =>
  /* HTML */ `<section class="reading" aria-label="Transcript">
    <div id="transcript" tabindex="0">${body(r, signedIn)}</div>
  </section>`;
