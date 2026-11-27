// Home: what you have recorded and what is still being prepared.
import { thumbnail } from '../shared/thumbnail.js';
import { esc } from '../shared/dom.js';
import { meta, status, total, newestFirst } from './format.js';

const RECENT = 5;

const stat = (value, label) =>
  `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

const row = (r) =>
  /* HTML */ `<button class="recent-row" data-record="${esc(r.id)}">
    ${thumbnail(r)}<span class="recent-copy"
      ><b>${esc(r.title)}</b><small>${esc(meta(r))}</small></span
    >${
      status(r)
        ? `<span class="chip ${r.status === 'error' ? 'warn' : ''}">${status(r)}</span>`
        : ''
    }
  </button>`;

export function home(s) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const recent = [...s.recordings].sort(newestFirst).slice(0, RECENT);
  const recorded = s.recordings.reduce((sum, r) => sum + (r.duration || 0), 0);
  return /* HTML */ `<section class="page">
    <header class="page-head">
      <h1>Home</h1>
      <span class="grow"></span><span class="caption">${today}</span>
    </header>
    <div class="stats">
      ${stat(s.recordings.length, 'Recordings')}${stat(total(recorded), 'Recorded')}
    </div>
    <section class="card" aria-label="Recent recordings">
      <header class="card-head">
        <span>Recent</span>${
          s.recordings.length > RECENT
            ? '<button class="page-link" data-view="recordings">All recordings →</button>'
            : ''
        }
      </header>
      ${
        recent.map(row).join('') ||
        /* HTML */ `<div class="page-empty">
          <b>No recordings yet</b>
          <p>Start one from the menu bar, or with ⇧⌘R from anywhere.</p>
        </div>`
      }
    </section>
  </section>`;
}
