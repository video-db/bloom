// Line icons. Shapes come from the Bloom design asset pack.
const SHAPES = {
  screen:
    '<rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8M12 17v4"/>',
  microphone:
    '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 10v1a6 6 0 0 0 12 0v-1M12 17v4M9 21h6"/>',
  audio:
    '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
  settings:
    '<path d="m9 3-.6 2.3-2 .9-2.1-.7-2 3.5 1.6 1.7v2.3L2.3 15l2 3.5 2.1-.7 2 .9L9 21h4l.6-2.3 2-.9 2.1.7 2-3.5-1.6-1.7V11l1.6-1.7-2-3.5-2.1.7-2-.9L13 3z"/><circle cx="11" cy="12" r="3"/>',
  window:
    '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9.5h18M6.5 7h.1M9.5 7h.1"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
  recordings:
    '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
  back: '<path d="M11 6l-6 6 6 6M5 12h14"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  pause:
    '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  mark: '<path d="M6.5 4h11v16.5L12 16.6l-5.5 3.9z"/>',
  warning: '<path d="M12 4.5l8.5 15h-17zM12 10.5v4M12 17.3v.1"/>',
};

export const icon = (name) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHAPES[name] || ''}</svg>`;
