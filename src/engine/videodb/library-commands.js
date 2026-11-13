const { newRecord } = require('./model');
const { paragraphs } = require('./paragraphs');

function createLibraryCommands(
  ctx,
  service,
  { beforeRename = async () => {} } = {},
) {
  async function refresh() {
    const scope = ctx.scope();
    const remote = await service.listRecordings();
    if (scope !== ctx.scope()) return;
    const records = ctx.get().recordings;
    const operations = service.pendingOperations();
    const accepted = new Set(remote.map((r) => r.id));
    const merged = remote.map((item) => {
      const local = records.find(
        (r) => r.videoId === item.id || r.id === item.id,
      );
      const operation = operations.find((op) => op.key === `video:${item.id}`);
      return {
        ...newRecord({ id: item.id, title: item.title }),
        ...local,
        ...item,
        id: local?.id || item.id,
        videoId: item.id,
        pendingOperation: operation?.kind || null,
        status: item.streamUrl ? 'ready' : 'processing',
        jobStage: item.streamUrl ? 'complete' : 'playback',
      };
    });
    ctx.records([
      ...records.filter(
        (r) => !r.videoId || (!accepted.has(r.videoId) && r.pendingOperation),
      ),
      ...merged,
    ]);
    ctx.set({ online: true });
  }
  async function open(id) {
    const scope = ctx.scope();
    const record = ctx.find(id);
    if (!record?.videoId) return;
    // Playback failure must not hide a readable transcript, or vice versa.
    const [playback, transcript] = await Promise.allSettled([
      service.getPlayback(record.videoId, record.collectionId),
      service.transcript(record.videoId, record.collectionId),
    ]);
    if (scope !== ctx.scope()) return;
    if (playback.status === 'fulfilled')
      ctx.update(id, {
        streamUrl: playback.value.streamUrl,
        playerUrl: playback.value.playerUrl,
        thumbnailUrl: playback.value.thumbnailUrl,
        status: playback.value.streamUrl ? 'ready' : 'processing',
      });
    if (transcript.status === 'fulfilled' && transcript.value.text.trim())
      ctx.update(id, {
        transcript: transcript.value.text,
        transcriptStatus: transcript.value.status,
        paragraphs: paragraphs(transcript.value.words),
      });
    else
      ctx.update(id, {
        transcriptStatus: record.transcript
          ? 'ready'
          : transcript.status === 'fulfilled'
            ? transcript.value.status
            : 'error',
      });
    if (playback.status === 'rejected') throw playback.reason;
  }

  const commands = {
    refresh,
    openRecording: ({ id }) => open(id),
    async renameRecording({ id, text }) {
      const record = ctx.find(id);
      if (!record || record.readOnly) return;
      const scope = ctx.scope();
      ctx.update(id, { titleOrigin: 'user', requestedTitle: text });
      await beforeRename(id);
      if (scope !== ctx.scope()) return;
      if (!record.videoId) {
        ctx.update(id, { title: text, requestedTitle: text });
        return;
      }
      ctx.update(id, { pendingOperation: 'rename' });
      const result = await service.rename(record.videoId, text);
      ctx.update(id, {
        title: result.title,
        titleOrigin: 'user',
        requestedTitle: text,
        pendingOperation: null,
      });
      if (ctx.get().result?.id === id)
        ctx.set({ result: { ...ctx.get().result, title: result.title } });
    },
    async deleteRecording({ id }) {
      const record = ctx.find(id);
      if (!record?.videoId || record.readOnly) return;
      ctx.update(id, { pendingOperation: 'delete' });
      await service.deleteRecording(record.videoId);
      ctx.records(ctx.get().recordings.filter((r) => r.id !== id));
    },
    async reconcileRecording({ id }) {
      const record = ctx.find(id);
      if (!record?.videoId) return;
      const result = await service.reconcileRecording(record.videoId);
      if (result.reconciliationNeeded) return;
      if (!result.exists)
        ctx.records(ctx.get().recordings.filter((r) => r.id !== id));
      else
        ctx.update(id, {
          title: result.recording.title,
          pendingOperation: null,
        });
    },
    async requestTranscript({ id }) {
      const record = ctx.find(id);
      if (!record?.videoId || record.readOnly) return;
      if (record.transcriptStatus === 'processing') return;
      const scope = ctx.scope();
      ctx.update(id, { transcriptStatus: 'processing' });
      try {
        await service.requestTranscript(record.videoId);
      } catch (error) {
        if (scope === ctx.scope())
          ctx.update(id, {
            transcriptStatus: record.transcript
              ? 'ready'
              : error.uncertain
                ? 'error'
                : 'not-requested',
          });
        throw error;
      }
      if (scope === ctx.scope()) {
        ctx.update(id, { transcriptRequested: true });
        await open(id);
      }
    },
  };
  return { commands, refresh, open };
}

module.exports = { createLibraryCommands };
