const { newRecord } = require('./model');

function createLibraryCommands(ctx, service) {
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
    const playback = await service.getPlayback(
      record.videoId,
      record.collectionId,
    );
    if (scope !== ctx.scope()) return;
    ctx.update(id, {
      streamUrl: playback.streamUrl,
      playerUrl: playback.playerUrl,
      status: playback.streamUrl ? 'ready' : 'processing',
    });
    try {
      const transcript = await service.transcript(
        record.videoId,
        record.collectionId,
      );
      if (scope === ctx.scope())
        ctx.update(id, {
          transcript: transcript.text,
          transcriptStatus: transcript.status,
          words: transcript.words,
        });
    } catch (error) {
      if (scope === ctx.scope()) ctx.update(id, { transcriptStatus: 'error' });
    }
  }
  const commands = {
    refresh,
    openRecording: ({ id }) => open(id),
    async renameRecording({ id, text }) {
      const record = ctx.find(id);
      if (!record || record.readOnly) return;
      if (!record.videoId) {
        ctx.update(id, { title: text, requestedTitle: text });
        return;
      }
      ctx.update(id, { pendingOperation: 'rename' });
      const result = await service.rename(record.videoId, text);
      ctx.update(id, { title: result.title, pendingOperation: null });
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
      ctx.update(id, { transcriptStatus: 'processing' });
      await service.requestTranscript(record.videoId);
      await open(id);
    },
  };
  return { commands, refresh, open };
}

module.exports = { createLibraryCommands };
