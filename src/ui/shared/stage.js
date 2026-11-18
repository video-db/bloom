// What a recording that is not ready yet is doing, in a few words, and how far along it is.
// Nothing here asks the person to act: Bloom carries on by itself.
export function stage(r) {
  // Still being captured: nothing is processed until the recording has stopped.
  if (r.jobStage === 'recording' && r.status !== 'error')
    return { label: 'Recording' };
  if (r.status === 'error')
    return { label: r.videoId ? 'Needs attention' : 'Can’t be processed' };
  if (r.jobStage === 'waiting-connection')
    return { label: 'Waiting for connection', wait: true };
  if (r.jobStage === 'sending')
    return { label: 'Processing', progress: r.progress ?? null };
  if (['registering', 'playback'].includes(r.jobStage))
    return { label: 'Making it playable' };
  return { label: 'Processing' };
}

const pct = (p) => Math.min(100, Math.max(0, Math.floor(p * 100)));
export const percent = (p) => (Number.isFinite(p) ? `${pct(p)}%` : '');
export const progressBar = (p) =>
  Number.isFinite(p)
    ? `<span class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct(p)}"><i style="width:${pct(p)}%"></i></span>`
    : '';
// One line: "Processing 43%", "Making it playable", …
export const stageLine = (r) => {
  const s = stage(r);
  return [s.label, s.progress != null ? percent(s.progress) : '']
    .filter(Boolean)
    .join(' ');
};
