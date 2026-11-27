import { thumbnail } from '../shared/thumbnail.js';
// Recordings: everything you have recorded, as tiles grouped by date, with a filter and a
// sort.
import { esc } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
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
  // Videos with no date (another collection's) are one plain grid, with no heading.
  if (!shown.some((r) => r.createdAt))
    return `<div class="tiles">${shown.map(tile).join('')}</div>`;
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

// What to show and in what order, behind one icon. A dot on it says a filter is on.
function options(filter, order) {
  const choice =
    (kind, current) =>
    ([id, label]) =>
      /* HTML */ `<button
        role="menuitemradio"
        aria-checked="${id === current}"
        data-browse="${kind}"
        data-value="${id}"
      >
        <span class="menu-tick">${id === current ? icon('check') : ''}</span
        >${label}
      </button>`;
  const filtered = filter !== FILTERS[0][0];
  const label = `Filter and sort${filtered ? `: showing ${pick(FILTERS, filter)[1]}` : ''}`;
  return /* HTML */ `<details class="record-menu browse-menu">
    <summary aria-label="${label}" title="${label}">
      ${icon('filter')}${filtered ? '<span class="browse-dot"></span>' : ''}
    </summary>
    <div role="menu">
      <span class="menu-label">Show</span>
      ${FILTERS.map(choice('filter', filter)).join('')}
      <span class="menu-label">Sort</span>
      ${ORDERS.map(choice('order', order)).join('')}
    </div>
  </details>`;
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
      ${options(filter, order)}
    </header>
    ${waiting || (shown.length ? tiles(shown, byDate) : empty)}
  </section>`;
}
