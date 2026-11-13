// What VideoDB can say about a recording from its transcript: a summary, key points and
// action items, each tied to the moment it comes from.
const { ServiceError } = require('./errors');

const MAX_INPUT = 24000; // characters of transcript sent; longer recordings are cut here
const MAX_POINTS = 6;

const prompt = (lines) =>
  `You are summarising the transcript of a screen recording for the person who recorded it.
Each line starts with the time in seconds, in square brackets, at which it was said.
Return only JSON of this shape:
{"summary": "two or three plain sentences",
 "keyPoints": [{"text": "one sentence", "at": 12}],
 "actionItems": [{"text": "one sentence, starting with a verb", "at": 40}]}
Rules: at most ${MAX_POINTS} key points and ${MAX_POINTS} action items; "at" is the bracketed time of the line the point comes from; use an empty list when there are no action items; say only what the transcript says.

Transcript:
${lines}`;

function createUnderstand({ account, read }) {
  return {
    // paragraphs: [{ at, text }] -> { text, keyPoints: [{ text, at }], actionItems: [...] }
    async summarise(paragraphs) {
      if (!Array.isArray(paragraphs) || !paragraphs.length)
        throw new ServiceError(
          'invalid-input',
          'A summary needs a transcript first.',
        );
      const scope = account();
      if (!scope.collection)
        throw new ServiceError(
          'collection-missing',
          'Create your Bloom collection before recording.',
        );
      const lines = paragraphs
        .map((p) => `[${Math.round(p.at)}] ${p.text}`)
        .join('\n')
        .slice(0, MAX_INPUT);
      const longest = Math.max(...paragraphs.map((p) => p.at));
      const result = await read(scope, () =>
        scope.collection.generateText(prompt(lines), 'basic', 'json'),
      );
      const output = result?.output;
      if (
        !output ||
        typeof output.summary !== 'string' ||
        !output.summary.trim()
      )
        throw new ServiceError(
          'invalid-response',
          'VideoDB returned an unreadable summary. Try again.',
        );
      const points = (list) =>
        (Array.isArray(list) ? list : [])
          .filter((item) => typeof item?.text === 'string' && item.text.trim())
          .slice(0, MAX_POINTS)
          .map((item) => ({
            text: item.text.trim().slice(0, 400),
            // A time outside the recording is not a moment.
            at:
              Number.isFinite(item.at) && item.at >= 0 && item.at <= longest + 1
                ? item.at
                : null,
          }));
      return {
        text: output.summary.trim().slice(0, 1200),
        keyPoints: points(output.keyPoints),
        actionItems: points(output.actionItems),
      };
    },
  };
}

module.exports = { createUnderstand };
