// The summary of a recording: a few sentences, key points and action items, each point with
// the time it comes from. Made from the transcript by the engine.
import { esc, clock } from '../shared/dom.js';
import { withoutTranscript } from './transcript.js';

const point = (p) =>
  /* HTML */ `<li>
    ${
      p.at === null
        ? ''
        : `<button class="ts" data-seek="${p.at}" title="Play from ${clock(p.at)}">${clock(p.at)}</button>`
    }${esc(p.text)}
  </li>`;

const list = (title, points) =>
  points.length
    ? `<h3 class="label">${title}</h3><ul class="points">${points.map(point).join('')}</ul>`
    : '';

function body(r, signedIn) {
  if (r.summary)
    return /* HTML */ `<p class="para">${esc(r.summary.text)}</p>
      ${list('Key points', r.summary.keyPoints)}${list(
        'Action items',
        r.summary.actionItems,
      )}
      <p class="caption summary-foot">
        Made from the transcript.
        ${
          r.readOnly
            ? ''
            : `<button class="page-link" data-command="summarise" data-id="${esc(r.id)}" ${r.summaryStatus === 'working' ? 'disabled' : ''}>${r.summaryStatus === 'working' ? 'Regenerating…' : 'Regenerate'}</button>`
        }
      </p>`;
  if (r.summaryStatus === 'working')
    return '<p class="reading-empty" role="status">Writing the summary…</p>';
  if (r.summaryStatus === 'error')
    return /* HTML */ `<p class="reading-empty" role="alert">
      The summary could not be made.
      <button class="page-link" data-command="summarise" data-id="${esc(r.id)}">
        Try again
      </button>
    </p>`;
  return r.transcript
    ? '<p class="reading-empty" role="status">Writing the summary…</p>'
    : `<p class="reading-empty">A summary needs a transcript.</p>${withoutTranscript(r, signedIn)}`;
}

export const summary = (r, signedIn) =>
  /* HTML */ `<section class="reading" aria-label="Summary">
    <div id="summary">${body(r, signedIn)}</div>
  </section>`;
