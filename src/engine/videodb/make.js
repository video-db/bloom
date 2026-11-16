// Making a tighter version of a recording, worked out on this Mac from the transcript's
// word timings: where nothing is said, what is kept once those stretches are cut, and where
// a moment of the original falls in the version. Nothing here talks to VideoDB.
const MIN_SILENCE = 0.8; // seconds without a word before a stretch counts as a silence
const KEEP = 0.15; // seconds kept either side of a cut, so words are not clipped
const round = (seconds) => Math.round(seconds * 100) / 100;

// words: [{ word, start, end }] in order, duration: seconds -> the stretches to cut,
// [{ from, to }], already narrowed by KEEP on each side that touches speech.
function quiet(words, duration) {
  if (!Array.isArray(words) || !words.length) return [];
  const length = Math.max(duration || 0, words.at(-1).end);
  const out = [];
  const add = (from, to) => {
    if (to - from > 0.05) out.push({ from: round(from), to: round(to) });
  };
  if (words[0].start >= MIN_SILENCE) add(0, words[0].start - KEEP);
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap >= MIN_SILENCE) add(words[i - 1].end + KEEP, words[i].start - KEEP);
  }
  if (length - words.at(-1).end >= MIN_SILENCE)
    add(words.at(-1).end + KEEP, length);
  return out;
}

// What a version keeps. record: { duration, quiet }, silences: cut them or not ->
// { ranges: [{ start, end }] kept in order, cuts: [{ from, to }], length }.
function plan(record, { silences = true } = {}) {
  const duration = round(Math.max(record.duration || 0, 0));
  const cuts = (silences ? record.quiet || [] : [])
    .map((cut) => ({
      from: Math.max(0, cut.from),
      to: Math.min(duration, cut.to),
    }))
    .filter((cut) => cut.to > cut.from)
    .sort((a, b) => a.from - b.from);
  const ranges = [];
  let at = 0;
  for (const cut of cuts) {
    if (cut.from > at) ranges.push({ start: round(at), end: round(cut.from) });
    at = Math.max(at, cut.to);
  }
  if (duration > at) ranges.push({ start: round(at), end: duration });
  return {
    ranges,
    cuts,
    length: round(ranges.reduce((sum, r) => sum + (r.end - r.start), 0)),
  };
}

// A moment of the original, as a moment of the version: the cuts before it are gone, and
// a moment inside a cut lands where that cut was.
function remap(at, cuts) {
  let gone = 0;
  for (const cut of cuts || []) {
    if (at <= cut.from) break;
    gone += Math.min(at, cut.to) - cut.from;
  }
  return round(Math.max(0, at - gone));
}

// The version's chapters: the summary's when it has them, otherwise the person's marks.
function chaptersFor(record, cuts) {
  const fromSummary = record.summary?.chapters || [];
  const source =
    fromSummary.length > 1
      ? fromSummary
      : (record.marks || []).map((m) => ({
          title: m.text || 'Marked moment',
          at: m.at,
        }));
  return source
    .map((c) => ({
      title: String(c.title).slice(0, 40),
      at: remap(c.at, cuts),
    }))
    .sort((a, b) => a.at - b.at)
    .filter((c, index, all) => !index || c.at > all[index - 1].at);
}

module.exports = { quiet, plan, remap, chaptersFor, MIN_SILENCE, KEEP };
