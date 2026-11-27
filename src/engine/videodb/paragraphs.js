// A transcript as paragraphs that follow the speaker. A new one starts where a sentence has
// ended and the speaker pauses, after a long silence wherever it falls, or at a sentence end
// once a paragraph is long. Each carries the time it starts at.
const PAUSE = 1.5; // seconds of silence after a sentence end that start a new paragraph
const SILENCE = 4; // seconds of silence that start one even mid-sentence
const LONG = 60; // words after which the next sentence end starts one
const SENTENCE_END = /[.!?…]["')\]]?$/;

// words: [{ word, start, end }] in order -> [{ at, text }]
function paragraphs(words) {
  const out = [];
  let current = null;
  let previous = null;
  for (const w of words) {
    const gap = previous ? w.start - previous.end : 0;
    const ended = previous && SENTENCE_END.test(previous.word);
    const paused = gap >= SILENCE || (ended && gap >= PAUSE);
    const long = ended && current.count >= LONG;
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
