// The onboarding screen preview is taken only when allowed, one capture at a time, and a
// failure degrades to nothing instead of an error.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createScreenPreview } = require('../main/screen-preview');

const image = (data) => ({ isEmpty: () => !data, toDataURL: () => data });

test('no capture is attempted unless it is allowed', async () => {
  let calls = 0;
  const preview = createScreenPreview({
    allowed: () => false,
    capturer: { getSources: async () => (calls++, []) },
  });
  assert.equal(await preview.capture(), null);
  assert.equal(calls, 0);
});

test('returns a small still of the first screen and shares one capture between callers', async () => {
  const requests = [];
  const preview = createScreenPreview({
    allowed: () => true,
    capturer: {
      getSources: async (options) => {
        requests.push(options);
        return [{ thumbnail: image('data:image/png;base64,AAAA') }];
      },
    },
  });
  const [a, b] = await Promise.all([preview.capture(), preview.capture()]);
  assert.equal(a, 'data:image/png;base64,AAAA');
  assert.equal(b, a);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].types, ['screen']);
  assert(
    requests[0].thumbnailSize.width <= 320,
    'a thumbnail, not a screenshot',
  );
  await preview.capture();
  assert.equal(requests.length, 2, 'a later call captures again');
});

test('an empty image, no screen or a capture error all give nothing', async () => {
  for (const getSources of [
    async () => [{ thumbnail: image('') }],
    async () => [],
    async () => {
      throw new Error('denied');
    },
  ]) {
    const preview = createScreenPreview({
      allowed: () => true,
      capturer: { getSources },
    });
    assert.equal(await preview.capture(), null);
  }
});
