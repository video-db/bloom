// How a recording's date, length and state read wherever the main window shows it.
import { stageLine } from '../shared/stage.js';
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
  r.status === 'ready'
    ? r.transcriptStatus === 'processing'
      ? 'Understanding'
      : ''
    : stageLine(r);
// The length is known once the recording has stopped; 0:00 while it is made says nothing.
export const meta = (r) =>
  [day(r), r.jobStage === 'recording' && !r.duration ? '' : clock(r.duration)]
    .filter(Boolean)
    .join(' · ');
export const newestFirst = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
// Which group a recording falls in when listed by date, as Finder names them: Today,
// Yesterday, Previous 7 Days, Previous 30 Days, then the month, then the year.
export function period(createdAt, now = Date.now()) {
  if (!createdAt) return 'Earlier';
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;
  const days = Math.ceil((today.getTime() - createdAt) / DAY); // 0 or less is today
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 7) return 'Previous 7 Days';
  if (days <= 30) return 'Previous 30 Days';
  const date = new Date(createdAt);
  return date.getFullYear() === today.getFullYear()
    ? date.toLocaleDateString(undefined, { month: 'long' })
    : String(date.getFullYear());
}
// Total time across recordings: "40 s", "4 m", "1 h 52 m".
export function total(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60
    ? `${minutes} m`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}
