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

function connectedFixture({
  cache = createRecordingCache(),
  records = [],
  autoRestore = false,
} = {}) {
  const events = new EventEmitter();
  const outcomes = new Map();
  const waits = new Map();
  const calls = [];
  const remote = new Map(records.map((r) => [r.id, r]));
  let clock = 0,
    serial = 0;
  const scopeId = 'a'.repeat(64);
  const service = {
    apiUrl: 'https://api.dev.videodb.io',
    cachedIdentity: () => null,
    restore: async () => null,
    signIn: async () => ({ scopeId }),
    signOut() {},
    ensureCollection: async () => 'collection-1',
    createSession: async () => ({
      id: `session-${++serial}`,
      endUserId: 'owner-1',
    }),
    ownsSession: async () => true,
    pendingOperations: () => [],
    listRecordings: async () => [...remote.values()],
    getPlayback: async (id) => remote.get(id),
    transcript: async () => ({
      status: 'ready',
      text: 'Recorded words',
      words: [],
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
    recover: async () => recorder.jobs,
    onEvent(listener) {
      events.on('event', listener);
      return () => events.off('event', listener);
    },
    async start(args) {
      calls.push(['start', args]);
      this.active = args.sessionId;
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
  });
  async function command(name, args = {}) {
    engine.command(name, args);
    await engine.whenIdle();
  }
  return {
    engine,
    service,
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

module.exports = { connectedFixture, deferred, flush };
