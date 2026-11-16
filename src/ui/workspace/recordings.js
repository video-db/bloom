import { thumbnail } from '../shared/thumbnail.js';
// Recordings: everything you have recorded, as tiles grouped by date, with a filter and a
// sort.
import { esc } from '../shared/dom.js';
import { meta, status, newestFirst, period } from './format.js';

const FILTERS = [
  ['all', 'All', () => true],
  [
    'processing',
    'Processing',
    (r) => r.status !== 'ready' && r.status !== 'error',
  ],
  ['attention', 'Needs attention', (r) => r.status === 'error'],
];
const ORDERS = [
  // The two orders by date are shown in groups: Today, Yesterday, and so on.
  ['newest', 'Newest', newestFirst, true],
  ['oldest', 'Oldest', (a, b) => newestFirst(b, a), true],
  ['name', 'A–Z', (a, b) => a.title.localeCompare(b.title)],
  ['longest', 'Longest', (a, b) => b.duration - a.duration],
];
const pick = (list, key) => list.find(([id]) => id === key) || list[0];

const tile = (r) =>
  /* HTML */ `<button
    class="tile"
    data-record="${esc(r.id)}"
    title="${esc(r.title)}"
  >
    ${thumbnail(r)}<b>${esc(r.title)}</b
    ><small>${esc([meta(r), status(r)].filter(Boolean).join(' · '))}</small>
  </button>`;

// The tiles, under a heading for each stretch of time when they are in date order.
function tiles(shown, byDate) {
  if (!byDate) return `<div class="tiles">${shown.map(tile).join('')}</div>`;
  const groups = [];
  for (const r of shown) {
    const name = period(r.createdAt);
    if (groups.at(-1)?.name === name) groups.at(-1).list.push(r);
    else groups.push({ name, list: [r] });
  }
  return groups
    .map(
      ({ name, list }) =>
        /* HTML */ `<section class="tile-group" aria-label="${esc(name)}">
          <h2 class="label">${esc(name)}</h2>
          <div class="tiles">${list.map(tile).join('')}</div>
        </section>`,
    )
    .join('');
}

// browse: { filter, order } — how this window is looking at its recordings.
// When another collection is being browsed, its videos show here instead of Bloom's own.
export function recordings(s, browse) {
  const [filter, , keep] = pick(FILTERS, browse.filter);
  const [order, , compare, byDate] = pick(ORDERS, browse.order);
  const all = s.browsing ? s.browsing.recordings : s.recordings;
  const shown = all.filter(keep).sort(compare);
  const waiting = {
    loading:
      '<div class="page-empty" role="status"><p>Loading this collection…</p></div>',
    error:
      '<div class="page-empty" role="alert"><b>This collection could not be loaded</b><p>Check your connection and choose it again.</p></div>',
  }[s.browsing?.status];
  const empty = all.length
    ? '<div class="page-empty"><b>Nothing here</b><p>No recording matches this filter.</p></div>'
    : s.browsing
      ? '<div class="page-empty"><b>This collection is empty</b></div>'
      : '<div class="page-empty"><b>No recordings yet</b><p>Start one from the menu bar, or with ⇧⌘R from anywhere.</p></div>';
  return /* HTML */ `<section class="page">
    <header class="page-head">
      <h1>${s.browsing ? esc(s.browsing.name) : 'Recordings'}</h1>
      <span class="caption">${waiting ? '' : all.length}</span>
      <span class="grow"></span>
      <span class="seg" role="group" aria-label="Filter recordings"
        >${FILTERS.map(
          ([id, label]) =>
            `<button class="${id === filter ? 'on' : ''}" aria-pressed="${id === filter}" data-browse="filter" data-value="${id}">${label}</button>`,
        ).join('')}</span
      >
      <select data-browse="order" aria-label="Sort recordings">
        ${ORDERS.map(
          ([id, label]) =>
            `<option value="${id}" ${id === order ? 'selected' : ''}>${label}</option>`,
        ).join('')}
      </select>
    </header>
    ${waiting || (shown.length ? tiles(shown, byDate) : empty)}
  </section>`;
}
