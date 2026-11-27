import { esc } from './dom.js';

export const thumbnail = (record) =>
  `<span class="shot">${record.thumbnailUrl ? `<img src="${esc(record.thumbnailUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;

// Failed remote images leave the approved placeholder visible.
export function bindThumbnails(root) {
  root.addEventListener(
    'error',
    (event) => {
      if (event.target.matches?.('.shot img')) event.target.remove();
    },
    true,
  );
}
