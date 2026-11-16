// Making a tighter version of a recording, worked out on this Mac from the transcript's
// word timings: where nothing is said, what is kept once those stretches are cut, and where
// a moment of the original falls in the version. Nothing here talks to VideoDB.
const MIN_SILENCE = 0.8; // seconds without a word before a stretch counts as a silence
const KEEP = 0.15; // seconds kept either side of a cut, so words are not clipped
const round = (seconds) => Math.round(seconds * 100) / 100;
// Down to the hundredth: VideoDB refuses a clip that runs past the end of its source, so a
// length is never rounded up.
const floor = (seconds) => Math.floor(seconds * 100 + 1e-6) / 100;
const CARD_SECONDS = 3; // an opening or end card: the words alone, before or after

// words: [{ word, start, end }] in order, duration: seconds -> the stretches to cut,
// [{ from, to }], already narrowed by KEEP on each side that touches speech.
function quiet(words, duration) {
  if (!Array.isArray(words) || !words.length) return [];
  // In order of when they start; a word can overlap the ones after it, so what counts is
  // the latest end heard so far, not the previous word's.
  const said = [...words].sort((a, b) => a.start - b.start);
  const out = [];
  const add = (from, to) => {
    if (to - from > 0.05) out.push({ from: round(from), to: round(to) });
  };
  if (said[0].start >= MIN_SILENCE) add(0, said[0].start - KEEP);
  let heard = said[0].end;
  for (const next of said.slice(1)) {
    if (next.start - heard >= MIN_SILENCE) add(heard + KEEP, next.start - KEEP);
    heard = Math.max(heard, next.end);
  }
  const length = Math.max(duration || 0, heard);
  if (length - heard >= MIN_SILENCE) add(heard + KEEP, length);
  return out;
}

// What a version keeps. record: { duration, quiet }, silences: cut them or not ->
// { ranges: [{ start, end }] kept in order, cuts: [{ from, to }], length }.
function plan(record, { silences = true } = {}) {
  const duration = floor(Math.max(record.duration || 0, 0));
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

// A moment of the original, as a moment of the version: the cuts before it are gone, a
// moment inside a cut lands where that cut was, and an opening card (lead) comes first.
function remap(at, cuts, lead = 0) {
  let gone = 0;
  for (const cut of cuts || []) {
    if (at <= cut.from) break;
    gone += Math.min(at, cut.to) - cut.from;
  }
  return round(Math.max(0, at - gone) + lead);
}

// The version's chapters: the summary's when it has them, otherwise the person's marks.
function chaptersFor(record, cuts, lead = 0) {
  const fromSummary = record.summary?.chapters || [];
  const source =
    fromSummary.length > 1
      ? fromSummary
      : (record.marks || []).map((m) => ({
          title: m.text || 'Marked moment',
          at: m.at,
        }));
  return (
    source
      .map((c) => ({
        title: String(c.title).slice(0, 40),
        at: remap(c.at, cuts, lead),
      }))
      .sort((a, b) => a.at - b.at)
      .filter((c, index, all) => !index || c.at > all[index - 1].at)
      // The first chapter runs from the start, an opening card included.
      .map((c, index) =>
        index === 0 && fromSummary.length > 1 ? { ...c, at: 0 } : c,
      )
  );
}

// What was kept on disk, read back: only stretches and versions that are what they should
// be reach the window. A version must have a secure link to play.
const spans = (list) =>
  (Array.isArray(list) ? list : [])
    .filter(
      (span) =>
        Number.isFinite(span?.from) &&
        Number.isFinite(span?.to) &&
        span.from >= 0 &&
        span.to > span.from,
    )
    .map(({ from, to }) => ({ from, to }));
const link = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
function storedVersions(list) {
  return (Array.isArray(list) ? list : [])
    .filter(
      (v) =>
        v &&
        typeof v.id === 'string' &&
        typeof v.name === 'string' &&
        Number.isFinite(v.duration) &&
        v.duration > 0 &&
        link(v.streamUrl),
    )
    .map((v) => ({
      id: v.id,
      recipe: 'walkthrough',
      name: v.name.slice(0, 60),
      streamUrl: link(v.streamUrl),
      playerUrl: link(v.playerUrl),
      duration: v.duration,
      createdAt: Number.isFinite(v.createdAt) ? v.createdAt : 0,
      cuts: spans(v.cuts),
      subtitles: !!v.subtitles,
      titled: !!v.titled,
      lead: Number.isFinite(v.lead) && v.lead > 0 ? v.lead : 0,
      chapters: (Array.isArray(v.chapters) ? v.chapters : [])
        .filter(
          (c) =>
            typeof c?.title === 'string' && Number.isFinite(c.at) && c.at >= 0,
        )
        .map(({ title, at }) => ({ title: title.slice(0, 40), at })),
    }));
}

module.exports = {
  quiet,
  plan,
  remap,
  chaptersFor,
  spans,
  storedVersions,
  CARD_SECONDS,
  MIN_SILENCE,
  KEEP,
};
