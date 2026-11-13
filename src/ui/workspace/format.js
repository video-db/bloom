// How a recording's date, length and state read wherever the main window shows it.
import { clock } from '../shared/dom.js';

export const day = (r) =>
  r.createdAt
    ? new Date(r.createdAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : '';
// A ready recording needs no label. Only say something when there is something to know.
export const status = (r) =>
  r.status === 'error'
    ? r.videoId
      ? 'Needs attention'
      : 'Needs recovery'
    : r.status === 'ready'
      ? ''
      : 'Processing';
export const meta = (r) =>
  [day(r), clock(r.duration)].filter(Boolean).join(' · ');
export const newestFirst = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
// Total time across recordings: "40 s", "4 m", "1 h 52 m".
export function total(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60
    ? `${minutes} m`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}
