// Make: the recording page as a light editor. The video and timeline stay where they are;
// lanes under the timeline show what would change, and a panel of choices says what each
// does in numbers. "Make video" asks the engine for a new version; the original is never
// changed.
import { esc, clock } from '../shared/dom.js';
import { withoutTranscript } from './transcript.js';
import { versionsNote } from './versions.js';

const TITLE_SECONDS = 2.5; // how long the title card shows; the engine's editing.js agrees

// The silences that would be cut, and what cutting them saves.
export const silences = (r) => {
  const list = (r.quiet || []).filter((q) => q.to > q.from);
  return {
    list,
    saves: list.reduce((sum, q) => sum + (q.to - q.from), 0),
  };
};
// Chapters a version would carry: the summary's, or else the person's marks.
const chapterSource = (r) =>
  (r.summary?.chapters || []).length > 1
    ? { count: r.summary.chapters.length, word: 'chapters' }
    : { count: (r.marks || []).length, word: 'marks' };

// What the choices come to for this recording: a choice with nothing to act on is off.
export function chosen(r, page) {
  const c = page.choices;
  return {
    silences: c.silences && silences(r).list.length > 0,
    subtitles: c.subtitles,
    title: c.title,
    chapters: c.chapters && chapterSource(r).count > 0,
    text: (page.titleText ?? r.title).trim().slice(0, 80),
  };
}

// Blocks along a lane, placed on the original's time.
const blocks = (kind, spans, total) =>
  spans
    .map(
      ({ from, to }) =>
        `<i class="${kind}" style="left:${(from / total) * 100}%;width:${Math.max(((to - from) / total) * 100, 0.4)}%"></i>`,
    )
    .join('');

// Under the timeline: exactly what would change, lane by lane. A choice that is off has
// an empty lane.
export function lanes(r, page) {
  const total = Math.max(r.duration || 0, 1);
  const on = chosen(r, page);
  const cuts = silences(r).list;
  // Subtitles run wherever something is said: everything between the silences.
  const said = [];
  let at = 0;
  for (const cut of cuts) {
    if (cut.from > at) said.push({ from: at, to: cut.from });
    at = Math.max(at, cut.to);
  }
  if (total > at) said.push({ from: at, to: total });
  const lane = (name, content) =>
    /* HTML */ `<div class="lane-row">
      <span>${name}</span>
      <div class="lane">${content}</div>
    </div>`;
  return /* HTML */ `<div class="lanes" aria-label="What will change">
    ${lane('Cuts', on.silences ? blocks('x', cuts, total) : '')}
    ${lane(
      'Subtitles',
      on.subtitles && r.transcript ? blocks('s', said, total) : '',
    )}
    ${lane(
      'Title',
      on.title
        ? blocks('t', [{ from: 0, to: Math.min(TITLE_SECONDS, total) }], total)
        : '',
    )}
  </div>`;
}

const option = ({ key, on, label, detail = '', disabled = false }) =>
  /* HTML */ `<button
    class="opt-row"
    role="checkbox"
    aria-checked="${on}"
    data-choice="${key}"
    ${disabled ? 'disabled' : ''}
  >
    <span class="opt-check">${on ? '✓' : ''}</span><span>${label}</span
    ><span class="caption">${detail}</span>
  </button>`;

// The choices, the new length and the button.
export function makePanel(r, page, signedIn) {
  if (r.status !== 'ready' || !r.videoId)
    return /* HTML */ `<aside class="make-panel" aria-label="Make a video">
      <p class="reading-empty">
        This recording is still being processed. A video can be made from it
        once it is ready.
      </p>
    </aside>`;
  if (!r.transcript)
    return /* HTML */ `<aside class="make-panel" aria-label="Make a video">
      <p class="reading-empty">
        Making a video needs a transcript: silences and subtitles come from what
        was said.
      </p>
      ${withoutTranscript(r, signedIn)}
    </aside>`;
  const on = chosen(r, page);
  const quiet = silences(r);
  const chapters = chapterSource(r);
  const length = Math.max(
    0,
    (r.duration || 0) - (on.silences ? quiet.saves : 0),
  );
  const working = r.making?.status === 'working';
  const nothing = !on.silences && !on.subtitles && !on.title;
  return /* HTML */ `<aside class="make-panel" aria-label="Make a video">
    <div>
      <span class="label">Make it a</span>
      <div class="recipes">
        <div class="recipe on"><b>Walkthrough</b>Tight, easy to follow</div>
      </div>
    </div>
    <div class="opts" role="group" aria-label="What to change">
      ${option({
        key: 'silences',
        on: on.silences,
        label: quiet.list.length
          ? `Remove ${quiet.list.length} ${quiet.list.length === 1 ? 'silence' : 'silences'}`
          : 'No silences to remove',
        detail: quiet.list.length ? `saves ${clock(quiet.saves)}` : '',
        disabled: !quiet.list.length,
      })}
      ${option({ key: 'subtitles', on: on.subtitles, label: 'Subtitles' })}
      ${option({ key: 'title', on: on.title, label: 'Title card' })}
      ${
        on.title
          ? /* HTML */ `<label class="opt-field"
              ><span class="caption">Shown over the first seconds</span
              ><input
                class="field"
                data-title-text
                data-focus="title-text"
                maxlength="80"
                value="${esc(page.titleText ?? r.title)}"
                aria-label="Title card text"
            /></label>`
          : ''
      }
      ${option({
        key: 'chapters',
        on: on.chapters,
        label: 'Chapters',
        detail: chapters.count ? `${chapters.count} ${chapters.word}` : 'none',
        disabled: !chapters.count,
      })}
    </div>
    <div class="make-length">
      <b>${clock(length)}</b>
      <span class="caption">from ${clock(r.duration)}</span>
    </div>
    ${
      r.making?.status === 'error'
        ? `<p class="make-problem" role="alert">${esc(r.making.message)}</p>`
        : ''
    }
    <button
      class="btn make-go"
      data-make="${esc(r.id)}"
      ${working || nothing ? 'disabled' : ''}
    >
      ${working ? 'Making…' : 'Make video'}
    </button>
    ${
      working
        ? '<p class="caption" role="status">This can take a minute. You can keep using Bloom; the page comes back to Watch when it is ready.</p>'
        : '<p class="caption">Nothing changes the original.</p>'
    }
    ${versionsNote('The new version is kept with this recording on this Mac.')}
  </aside>`;
}
