const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSDKRecorder } = require('../engine/videodb/recorder');

function fixture() {
  const instances = [],
    tokenRequests = [];
  class Client extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      instances.push(this);
    }
    async listChannels() {
      return {
        displays: [{ id: 'display:1', name: 'Screen' }],
        mics: [],
        systemAudio: [],
      };
    }
    async listLocalRecordings() {
      return [];
    }
    async requestPermission() {
      return 'granted';
    }
    async shutdown(options) {
      this.shutdownOptions = options;
      this.emit('shutdown', {});
    }
    async startSession(config) {
      this.startOptions = config;
    }
    async waitForProcessing(options) {
      return options;
    }
  }
  const service = {
    apiUrl: 'https://api.dev.videodb.io',
    captureCapabilities: () => ({ supported: true }),
    async recorderToken(request) {
      tokenRequests.push(request);
      return `synthetic-token-${tokenRequests.length}`;
    },
  };
  const recorder = createSDKRecorder({
    CaptureClient: Client,
    service,
    permissionStatus: () => false,
  });
  return { recorder, instances, tokenRequests, service };
}

test('the adapter preserves dev origin, refreshes same-owner tokens, and suppresses intentional replacement shutdown', async () => {
  const f = fixture();
  const events = [];
  f.recorder.onEvent((name) => events.push(name));
  await f.recorder.channels();
  await f.recorder.start({
    sessionId: 'session-1',
    channels: [{ channelId: 'display:1', type: 'video', store: false }],
  });
  assert.equal(f.instances[1].options.apiUrl, f.service.apiUrl);
  assert.deepEqual(f.tokenRequests[1], { sessionId: 'session-1' });
  const first = await f.instances[1].options.getRecorderToken({
    sessionId: 'session-1',
    forceRefresh: true,
  });
  const second = await f.instances[1].options.getRecorderToken({
    sessionId: 'session-1',
    forceRefresh: true,
  });
  assert.notEqual(first, second);
  assert.deepEqual(events, []);
});

test('a permission request acknowledgement does not become a granted OS permission', async () => {
  const { recorder } = fixture();
  assert.deepEqual(await recorder.requestPermission('screen'), {
    screen: false,
    mic: false,
    camera: false,
  });
});

test('unknown or foreign retained sessions get no refreshed credential', async () => {
  const f = fixture();
  await f.recorder.channels();
  f.service.recorderToken = async () => {
    throw Object.assign(new Error('forbidden'), { code: 'forbidden' });
  };
  assert.equal(
    await f.instances[0].options.getRecorderToken({ sessionId: 'foreign' }),
    null,
  );
});

test('explicit suspension uses the public shutdown option instead of killing the process', async () => {
  const f = fixture();
  await f.recorder.channels();
  await f.recorder.shutdown({ suspend: true });
  assert.deepEqual(f.instances[0].shutdownOptions, {
    waitForProcessing: false,
    timeoutMs: 900000,
  });
});
