// Where a transcript breaks into paragraphs, and how the reading column shows them.
const test = require('node:test');
const assert = require('node:assert/strict');

const { paragraphs } = require('../engine/videodb/paragraphs');
const view = () => import('../ui/workspace/transcript.js');
const say = (text, start, step = 0.3) =>
  text.split(' ').map((word, i) => ({
    word,
    start: start + i * step,
    end: start + i * step + 0.25,
  }));

test('a pause in speech starts a new paragraph at the time speech resumes', () => {
  const words = [
    ...say('First thought here.', 0),
    ...say('Second thought.', 10),
  ];
  assert.deepEqual(paragraphs(words), [
    { at: 0, text: 'First thought here.' },
    { at: 10, text: 'Second thought.' },
  ]);
});

test('a long run of speech breaks at a sentence end, never mid-sentence', () => {
  const sentence = `${Array(69).fill('word').join(' ')} end.`;
  const words = say(`${sentence} Next sentence starts`, 0);
  const result = paragraphs(words);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, sentence);
  assert.equal(result[1].text, 'Next sentence starts');
});

test('the reading column shows paragraphs with their times, or the plain text without them', async () => {
  const { transcript } = await view();
  assert.deepEqual(paragraphs([]), []);
  const plain = transcript({ transcript: 'Plain <text>', paragraphs: [] });
  assert.match(plain, /Plain &lt;text&gt;/);
  assert.doesNotMatch(plain, /data-seek/);
  const timed = transcript({
    transcript: 'One. Two.',
    paragraphs: [
      { at: 0, text: 'One.' },
      { at: 65, text: 'Two.' },
    ],
  });
  assert.equal((timed.match(/data-seek/g) || []).length, 2);
  assert.match(timed, />1:05</);
});
