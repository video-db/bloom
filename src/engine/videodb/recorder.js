const { EventEmitter } = require('node:events');
const { ServiceError, request } = require('./errors');

const EVENTS = [
  'local-recording-ready',
  'local-recording-failed',
  'recording-relay-failed',
  'recording-token-error',
  'processing-complete',
  'recording-complete',
  'shutdown',
  'error',
];

// All public Node SDK recorder calls and native event names are confined to this adapter.
function createSDKRecorder({
  CaptureClient,
  service,
  permissionStatus,
  permissionDecided = () => true,
}) {
  const events = new EventEmitter();
  let client = null;
  let initializing = null;
  const suspended = new Set();
  function construct(sessionToken) {
    const instance = new CaptureClient({
      sessionToken,
      apiUrl: service.apiUrl,
      restartOnError: false,
      getRecorderToken: async ({ sessionId, recordingId }) => {
        if (suspended.has(recordingId)) return null;
        try {
          return await service.recorderToken({ sessionId });
        } catch (error) {
          if (
            [
              'not-found',
              'forbidden',
              'signed-out',
              'account-changed',
            ].includes(error.code)
          )
            return null;
          throw error;
        }
      },
    });
    for (const name of EVENTS)
      instance.on(name, (payload) => {
        if (client === instance) events.emit('event', name, payload);
      });
    return instance;
  }
  async function ensure() {
    if (!service.captureCapabilities().supported)
      throw new ServiceError(
        'sdk-version',
        'Update the VideoDB SDK before recording.',
      );
    if (!client) {
      if (!initializing)
        initializing = service
          .recorderToken()
          .then((token) => {
            client = construct(token);
          })
          .finally(() => {
            initializing = null;
          });
      await initializing;
    }
    return client;
  }
  return {
    onEvent(listener) {
      events.on('event', listener);
      return () => events.off('event', listener);
    },
    permissions() {
      return {
        screen: permissionStatus('screen'),
        mic: permissionStatus('microphone'),
        // macOS has an answer for the microphone: allowed or refused, not still asking.
        micDecided: permissionDecided('microphone'),
        camera: false,
      };
    },
    async requestPermission(key) {
      await request(async () =>
        (await ensure()).requestPermission(
          key === 'screen' ? 'screen-capture' : 'microphone',
        ),
      );
      return this.permissions();
    },
    async channels() {
      const groups = await request(async () => (await ensure()).listChannels());
      const list = (values) =>
        Array.from(values || []).map((channel) => ({
          id: channel.id,
          name: channel.name,
        }));
      return {
        displays: list(groups.displays),
        mics: list(groups.mics),
        systemAudio: list(groups.systemAudio),
      };
    },
    async recover() {
      return request(async () => (await ensure()).listLocalRecordings());
    },
    async start({ sessionId, channels }) {
      const previous = await ensure();
      client = null;
      try {
        for (const job of await previous.listLocalRecordings())
          if (job.stage !== 'complete') suspended.add(job.recordingId);
        await previous.shutdown({
          waitForProcessing: false,
          timeoutMs: 900000,
        });
      } catch (error) {
        client = previous;
        throw error;
      }
      const token = await service.recorderToken({ sessionId });
      client = construct(token);
      await request(() => client.startSession({ sessionId, channels }), {
        timeoutMs: 315000,
        mutation: true,
      });
    },
    async stop() {
      return request(async () => (await ensure()).stopSession(), {
        timeoutMs: 160000,
        mutation: true,
      });
    },
    async pause(tracks) {
      return request(async () => (await ensure()).pauseTracks(tracks), {
        mutation: true,
      });
    },
    async resume(tracks) {
      return request(async () => (await ensure()).resumeTracks(tracks), {
        mutation: true,
      });
    },
    async relay(recordingId, sessionId) {
      suspended.delete(recordingId);
      const uploadToken = await service.recorderToken({ sessionId });
      return request(
        async () =>
          (await ensure()).relayRecording({ recordingId, uploadToken }),
        { mutation: true },
      );
    },
    async wait(identity) {
      return (await ensure()).waitForProcessing({
        ...identity,
        timeoutMs: 900000,
      });
    },
    async shutdown({ suspend = false } = {}) {
      if (initializing) await initializing;
      if (client) {
        if (suspend)
          for (const job of await client.listLocalRecordings())
            if (job.stage !== 'complete') suspended.add(job.recordingId);
        await client.shutdown({
          waitForProcessing: !suspend,
          timeoutMs: 900000,
        });
      }
      client = null;
    },
    // Quitting with a recorder that has not answered its shutdown: end its process so it
    // cannot keep running without Bloom. The SDK has no public call for this, so this is the
    // one place that reaches past it. Recordings on disk are untouched.
    abandon() {
      try {
        client?.binaryManager?.kill?.();
      } catch {
        // nothing more can be done from here
      }
      client = null;
    },
  };
}

module.exports = { createSDKRecorder };
