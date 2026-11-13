// A transcript as paragraphs that follow the speaker: a new one starts after a pause, or at
// a sentence end once a paragraph is long. Each carries the time it starts at.
const PAUSE = 1.5; // seconds of silence that start a new paragraph
const LONG = 60; // words after which the next sentence end starts one
const SENTENCE_END = /[.!?…]["')\]]?$/;

// words: [{ word, start, end }] in order -> [{ at, text }]
function paragraphs(words) {
  const out = [];
  let current = null;
  let previous = null;
  for (const w of words) {
    const paused = previous && w.start - previous.end >= PAUSE;
    const long =
      current && current.count >= LONG && SENTENCE_END.test(previous.word);
    if (!current || paused || long) {
      current = { at: w.start, parts: [], count: 0 };
      out.push(current);
    }
    current.parts.push(w.word);
    current.count += 1;
    previous = w;
  }
  return out.map(({ at, parts }) => ({ at, text: parts.join(' ') }));
}

module.exports = { paragraphs };
