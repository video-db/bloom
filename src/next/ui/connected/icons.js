// Line icons for the connected interface. Shapes come from the Bloom design asset pack.
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
  down: '<path d="M6 9.5l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

export const icon = (name) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHAPES[name] || ''}</svg>`;
