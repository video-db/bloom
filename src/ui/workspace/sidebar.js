// The sidebar: what Bloom offers, as places. Settings and the VideoDB credit sit in its footer.
import { logo } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { PLACES } from './places.js';

const place = (s, current) => (p) => {
  const on = p.id === current;
  return /* HTML */ `<button
    class="place ${on ? 'on' : ''}"
    data-view="${p.id}"
    aria-current="${on ? 'page' : 'false'}"
  >
    ${icon(p.icon)}<span>${p.label}</span>${
      p.count ? `<span class="place-count">${p.count(s)}</span>` : ''
    }
  </button>`;
};

// current: the place that is showing ('settings' lights the gear instead).
export const sidebar = (s, current) =>
  /* HTML */ `<nav class="sidebar" aria-label="Bloom">
    <div class="sidebar-brand">${logo}<span>Bloom</span></div>
    ${PLACES.map(place(s, current)).join('')}
    <footer class="sidebar-footer">
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
    </footer>
  </nav>`;
