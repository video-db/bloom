// The reading layout: where a transcript breaks into paragraphs.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../ui/workspace/transcript.js');
const say = (text, start, step = 0.3) =>
  text.split(' ').map((word, i) => ({
    word,
    start: start + i * step,
    end: start + i * step + 0.25,
  }));

test('a pause in speech starts a new paragraph at the time speech resumes', async () => {
  const { paragraphs } = await load();
  const words = [
    ...say('First thought here.', 0),
    ...say('Second thought.', 10),
  ];
  assert.deepEqual(paragraphs(words), [
    { at: 0, text: 'First thought here.' },
    { at: 10, text: 'Second thought.' },
  ]);
});

test('a long run of speech breaks at a sentence end, never mid-sentence', async () => {
  const { paragraphs } = await load();
  const sentence = `${Array(69).fill('word').join(' ')} end.`;
  const words = say(`${sentence} Next sentence starts`, 0);
  const result = paragraphs(words);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, sentence);
  assert.equal(result[1].text, 'Next sentence starts');
});

test('no word timings gives no paragraphs, and the view falls back to the text', async () => {
  const { paragraphs, transcript } = await load();
  assert.deepEqual(paragraphs([]), []);
  const html = transcript({ transcript: 'Plain <text>', words: [] });
  assert.match(html, /Plain &lt;text&gt;/);
  assert.doesNotMatch(html, /data-seek/);
});
