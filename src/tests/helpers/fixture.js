const { EventEmitter } = require('node:events');
const { createVideoDBEngine } = require('../../engine/videodb/engine');
const { createRecordingCache } = require('../../engine/videodb/cache');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

function createFixture({
  cache = createRecordingCache(),
  records = [],
  autoRestore = false,
  retryDelay,
  browserSignIn = null, // true: a stand-in browser the test answers through `browser`
} = {}) {
  let answer = null;
  const browser = {
    opened: 0,
    resolve(credential) {
      answer?.resolve(credential);
      answer = null;
    },
    reject(code, message) {
      const { ServiceError } = require('../../engine/videodb/errors');
      answer?.reject(Object.assign(new ServiceError(code, message), { browser: true }));
      answer = null;
    },
  };
  if (browserSignIn === true)
    browserSignIn = {
      available: () => true,
      pending: () => !!answer,
      start() {
        browser.opened += 1;
        if (answer) return answer.promise;
        let settle;
        const promise = new Promise((resolve, reject) => (settle = { resolve, reject }));
        answer = { ...settle, promise };
        return promise;
      },
      cancel: () => browser.reject('cancelled', 'Sign-in was cancelled.'),
    };
  const events = new EventEmitter();
  const outcomes = new Map();
  const waits = new Map();
  const calls = [];
  const remote = new Map(records.map((r) => [r.id, r]));
  let clock = 0,
    serial = 0;
  const scopeId = 'a'.repeat(64);
  const shelf = ['Design critique', 'Sprint demo'].map((title, index) => ({
    id: `shelf-${index + 1}`,
    title,
    duration: 300 + index * 60,
    streamUrl: 'https://stream.example/shelf.m3u8',
    playerUrl: `https://player.example/shelf-${index + 1}`,
    thumbnailUrl: `https://images.example/shelf-${index + 1}.svg`,
  }));
  let collections = [
    { id: 'collection-2', name: 'Product reviews', bloom: false },
    { id: 'collection-1', name: 'Bloom Recordings', bloom: true },
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `collection-x${index}`,
      name: `Team archive ${String(index + 1).padStart(2, '0')}`,
      bloom: false,
    })),
  ];
  const service = {
    apiUrl: 'https://api.dev.videodb.io',
    cachedIdentity: () => null,
    restore: async () => null,
    signIn: async () => ({ scopeId }),
    signInWithToken: async () => ({ scopeId }),
    signOut() {},
    ensureCollection: async () => 'collection-1',
    createSession: async () => ({
      id: `session-${++serial}`,
      endUserId: 'owner-1',
    }),
    ownsSession: async () => true,
    pendingOperations: () => [],
    listRecordings: async () => [...remote.values()],
    getPlayback: async (id, collectionId) =>
      collectionId ? shelf.find((video) => video.id === id) : remote.get(id),
    // A second collection with two videos, to browse read-only.
    summarise: async (paragraphs) => {
      calls.push(['summarise', paragraphs.length]);
      return {
        text: 'A short walk through two thoughts.',
        keyPoints: [{ text: 'The first thought is recorded.', at: 0 }],
        actionItems: [{ text: 'Follow up on the second thought.', at: 4 }],
        chapters: [
          { title: 'First thought', at: 0 },
          { title: 'Second thought', at: 4 },
        ],
      };
    },
    // A version is a new stream; the fake says what it was asked to make.
    makeVersion: async (args) => {
      calls.push(['makeVersion', args]);
      if (service.failNextVersion) {
        service.failNextVersion = false;
        throw new Error('render failed');
      }
      return {
        streamUrl: `https://stream.example/version-${++serial}.m3u8`,
        playerUrl: `https://player.example/version-${serial}`,
      };
    },
    usage: async () => ({ credits: 316.28 }),
    listCollections: async () => structuredClone(collections),
    renameCollection: async (id, title) => {
      calls.push(['renameCollection', id, title]);
      collections.find((c) => c.id === id).name = title;
    },
    deleteCollection: async (id) => {
      calls.push(['deleteCollection', id]);
      collections = collections.filter((c) => c.id !== id);
    },
    reconcileCollectionAction: async () => ({ reconciliationNeeded: false }),
    listCollectionVideos: async (id) => {
      calls.push(['listCollectionVideos', id]);
      return shelf;
    },
    // Finds the newest recording when asked about "second thought"; nothing otherwise.
    search: async (query) => {
      calls.push(['search', query]);
      const [first] = [...remote.values()];
      return first && /second thought/i.test(query)
        ? [
            {
              videoId: first.id,
              start: 4,
              end: 6,
              text: 'A second thought after a pause.',
            },
          ]
        : [];
    },
    transcript: async () => ({
      status: 'ready',
      text: 'Recorded words here. A second thought after a pause.',
      // A pause before the fourth word, so the transcript reads as two paragraphs.
      words: [
        ['Recorded', 0],
        ['words', 0.4],
        ['here.', 0.8],
        ['A', 4],
        ['second', 4.3],
        ['thought', 4.7],
        ['after', 5.1],
        ['a', 5.4],
        ['pause.', 5.6],
      ].map(([word, start]) => ({ word, start, end: start + 0.25 })),
    }),
    rename: async (id, title) => {
      calls.push(['rename', id, title]);
      const r = remote.get(id);
      r.title = title;
      return r;
    },
    deleteRecording: async (id) => {
      remote.delete(id);
    },
    reconcileRecording: async (id) => ({
      exists: remote.has(id),
      recording: remote.get(id),
      reconciliationNeeded: false,
    }),
    requestTranscript: async () => ({ requested: true }),
    prepareDownload: async () => ({
      url: 'https://download.example/video.mp4',
      name: 'video.mp4',
    }),
  };
  const recorder = {
    jobs: [],
    active: null,
    permission: { screen: true, mic: true, camera: false },
    permissions() {
      return { ...this.permission };
    },
    async requestPermission() {
      return this.permissions();
    },
    channels: async () => ({
      displays: [{ id: 'display:1', name: 'Built-in display' }],
      mics: [{ id: 'mic:1', name: 'Built-in microphone' }],
      systemAudio: [{ id: 'system_audio:1', name: 'System audio' }],
    }),
    // Two apps with open windows; a test can change the list to make one disappear.
    openWindows: [
      {
        id: 'window:a',
        app: 'Google Chrome',
        title: 'Billing – Northstar',
        width: 1440,
        height: 900,
      },
      {
        id: 'window:b',
        app: 'Google Chrome',
        title: 'Pull request #214',
        width: 1440,
        height: 900,
      },
      {
        id: 'window:c',
        app: 'Figma',
        title: 'Checkout flow',
        width: 1680,
        height: 1050,
      },
    ],
    async windows() {
      return { supported: true, windows: this.openWindows };
    },
    async switchWindow(id) {
      calls.push(['switchWindow', id]);
    },
    async setWindowEnabled(enabled) {
      calls.push(['setWindowEnabled', enabled]);
    },
    recover: async () => recorder.jobs,
    onEvent(listener) {
      events.on('event', listener);
      return () => events.off('event', listener);
    },
    async start(args) {
      calls.push(['start', args]);
      this.active = args.sessionId;
      return { recordingId: `job-${args.sessionId}` };
    },
    async stop() {
      calls.push(['stop']);
      const job = {
        sessionId: this.active,
        recordingId: `job-${this.active}`,
        stage: 'processing',
      };
      this.jobs.push(job);
      events.emit('event', 'local-recording-ready', job);
    },
    async pause(tracks) {
      calls.push(['pause', tracks]);
    },
    async resume(tracks) {
      calls.push(['resume', tracks]);
    },
    async relay(recordingId, sessionId) {
      calls.push(['relay', recordingId, sessionId]);
    },
    async wait(identity) {
      const key =
        identity.sessionId ||
        this.jobs.find((j) => j.recordingId === identity.recordingId)
          ?.sessionId;
      if (outcomes.has(key)) return outcomes.get(key);
      if (!waits.has(key)) waits.set(key, deferred());
      return waits.get(key).promise;
    },
    async shutdown(options) {
      calls.push(['shutdown', options]);
      // As the SDK does: waiting for processing ends when the recorder stops.
      for (const [key, wait] of waits) {
        wait.reject(new Error('Recorder exited before processing completed'));
        waits.delete(key);
      }
    },
    finish(sessionId = this.active) {
      const result = {
        id: `video-${sessionId}`,
        title: 'VideoDB title',
        duration: 10,
        streamUrl: 'https://stream.example/video.m3u8',
        playerUrl: 'https://player.example/video',
      };
      remote.set(result.id, result);
      const payload = {
        sessionId,
        recordingId: `job-${sessionId}`,
        result: { videoId: result.id },
      };
      outcomes.set(sessionId, payload);
      this.jobs = this.jobs.map((j) =>
        j.sessionId === sessionId
          ? { ...j, stage: 'complete', result: payload.result }
          : j,
      );
      events.emit('event', 'processing-complete', payload);
      waits.get(sessionId)?.resolve(payload);
      return payload;
    },
    emit: (name, payload) => events.emit('event', name, payload),
  };
  const engine = createVideoDBEngine({
    service,
    recorder,
    cache,
    autoRestore,
    now: () => clock,
    retryDelay,
    browserSignIn,
  });
  async function command(name, args = {}) {
    engine.command(name, args);
    await engine.whenIdle();
  }
  return {
    engine,
    service,
    browser,
    recorder,
    calls,
    remote,
    scopeId,
    command,
    advance(ms) {
      clock += ms;
    },
  };
}

module.exports = { createFixture, deferred, flush };
