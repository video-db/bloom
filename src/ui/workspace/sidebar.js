// The sidebar: what Bloom offers, as places, then the account's collections. The balance,
// Settings and the VideoDB credit sit in its footer.
import { esc, logo } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { PLACES } from './places.js';

const place = (s, current) => (p) => {
  const on = p.id === current;
  return /* HTML */ `<button
    class="place ${on ? 'on' : ''}"
    data-place="${p.id}"
    aria-current="${on ? 'page' : 'false'}"
  >
    ${icon(p.icon)}<span>${p.label}</span>${
      p.count ? `<span class="place-count">${p.count(s)}</span>` : ''
    }
  </button>`;
};

// Collections from VideoDB. Bloom's own is the Recordings place; any other opens read-only.
// A count shows only where the collection's videos have been listed.
function collections(s, browsing) {
  if (!s.collections.length) return '';
  const row = (c) => {
    const on = browsing ? s.browsing.id === c.id : false;
    const count = c.bloom
      ? s.recordings.length
      : on && s.browsing.status === 'ready'
        ? s.browsing.recordings.length
        : '';
    return /* HTML */ `<button
      class="collection ${on ? 'on' : ''}"
      data-collection="${esc(c.id)}"
      aria-current="${on ? 'page' : 'false'}"
      title="${esc(c.name)}"
    >
      <span>${esc(c.name)}</span>${
        count === '' ? '' : `<span class="place-count">${count}</span>`
      }
    </button>`;
  };
  return /* HTML */ `<div class="sidebar-group">Collections</div>
    <div class="collections">${s.collections.map(row).join('')}</div>`;
}

const balance = (s) =>
  s.credits === null
    ? ''
    : /* HTML */ `<button
        class="balance"
        data-ui="get-api-key"
        title="Manage your balance in VideoDB (opens your browser)"
      >
        <b><span>Balance</span><span>${s.credits.toFixed(2)}</span></b
        ><small>VideoDB credits · Manage in VideoDB ↗</small>
      </button>`;

// current: the place that is showing ('settings' lights the gear instead).
// browsing: true while Recordings is showing a collection other than Bloom's own.
export const sidebar = (s, current, browsing) =>
  /* HTML */ `<nav class="sidebar" aria-label="Bloom">
    <div class="sidebar-brand">${logo}<span>Bloom</span></div>
    ${PLACES.map(place(s, browsing ? '' : current)).join('')}
    ${collections(s, browsing)}
    <footer class="sidebar-footer">
      ${balance(s)}
      <div class="sidebar-foot-row">
        <span class="sidebar-credit"
          ><img
            class="videodb-wordmark"
            src="../assets/videodb-wordmark.png"
            alt="VideoDB"
            width="62"
            height="10"
          />${s.online ? '' : '<span>Offline</span>'}</span
        ><button
          class="icon-button ${current === 'settings' ? 'on' : ''}"
          data-view="settings"
          aria-label="Settings"
          title="Settings (⌘,)"
        >
          ${icon('settings')}
        </button>
      </div>
    </footer>
  </nav>`;
