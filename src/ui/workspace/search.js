// Search: find a moment in what was said across your recordings.
import { esc, clock } from '../shared/dom.js';
import { icon } from '../shared/icons.js';

const hit = (r) =>
  /* HTML */ `<button
    class="hit"
    data-record="${esc(r.id)}"
    data-at="${r.start}"
    title="Play from ${clock(r.start)}"
  >
    <span class="shot"></span
    ><span class="hit-copy"
      ><span class="hit-head"
        ><b>${esc(r.title)}</b><span class="ts">${clock(r.start)}</span></span
      ><span class="hit-text">${esc(r.text)}</span></span
    >
  </button>`;

const STATUS = {
  idle: () =>
    '<div class="page-empty"><b>Find a moment</b><p>Search covers what was said in recordings that have a transcript.</p></div>',
  searching: () =>
    '<div class="page-empty" role="status"><p>Searching…</p></div>',
  error: () =>
    '<div class="page-empty" role="alert"><b>Search did not finish</b><p>Check your connection and try again.</p></div>',
  ready: ({ results }) =>
    results.length
      ? `<span class="label">Moments · ${results.length}</span><div class="card hits">${results.map(hit).join('')}</div>`
      : '<div class="page-empty"><b>No moments found</b><p>Only recordings with a transcript can be searched. Open a recording and add one under “What Bloom knows”.</p></div>',
};

export function search(s) {
  const state = s.search;
  return /* HTML */ `<section class="page">
    <header class="page-head"><h1>Search</h1></header>
    <form class="search-box" data-form="search" role="search">
      ${icon('search')}<input
        name="q"
        data-focus="search"
        aria-label="Search what was said"
        placeholder="Search what was said in your recordings"
        maxlength="300"
        value="${esc(state.query)}"
        autocomplete="off"
      />
    </form>
    ${(STATUS[state.status] || STATUS.idle)(state)}
  </section>`;
}
