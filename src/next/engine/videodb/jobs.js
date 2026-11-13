const { randomUUID } = require('node:crypto');
const { newRecord } = require('./model');
const { ServiceError } = require('./errors');

function createJobs(ctx, { service, recorder }) {
  const waiting = new Set();
  const completing = new Set();
  let poll = null;
  let disposed = false;

  function forSession(sessionId) {
    return ctx.get().recordings.find((r) => r.sessionId === sessionId);
  }
  async function complete(payload) {
    if (!payload?.result?.videoId || completing.has(payload.sessionId)) return;
    const record = forSession(payload.sessionId);
    if (
      !record ||
      (record.videoId === payload.result.videoId && record.status === 'ready')
    )
      return;
    completing.add(payload.sessionId);
    const scope = ctx.scope();
    try {
      ctx.update(record.id, {
        videoId: payload.result.videoId,
        recordingId: payload.recordingId,
        jobStage: 'playback',
        status: 'processing',
      });
      const video = await service.getPlayback(payload.result.videoId);
      if (scope !== ctx.scope()) return;
      if (!video.streamUrl) throw new Error('playback pending');
      ctx.update(record.id, {
        status: 'ready',
        jobStage: 'complete',
        streamUrl: video.streamUrl,
        playerUrl: video.playerUrl,
        title: video.title,
        duration: video.duration || record.duration,
      });
      if (ctx.get().sessionId === payload.sessionId) {
        const ready = ctx.find(record.id);
        ctx.set({
          phase: 'finished',
          upload: null,
          problem: null,
          elapsed: ready.duration,
          result: {
            id: ready.id,
            title: ready.title,
            duration: ready.duration,
            stage: 0,
          },
        });
      }
      if (record.requestedTitle && video.title !== record.requestedTitle) {
        try {
          await service.rename(video.id, record.requestedTitle);
          if (scope !== ctx.scope()) return;
          ctx.update(record.id, { title: record.requestedTitle });
          if (ctx.get().result?.id === record.id)
            ctx.set({
              result: { ...ctx.get().result, title: record.requestedTitle },
            });
        } catch {
          if (scope === ctx.scope()) {
            ctx.update(record.id, { pendingOperation: 'rename' });
            ctx.set({
              notice:
                'Your video is ready to play. The requested name change needs to be checked.',
            });
          }
        }
      }
    } catch {
      if (scope !== ctx.scope()) return;
      ctx.update(record.id, { status: 'error', jobStage: 'playback' });
      if (ctx.get().sessionId === payload.sessionId)
        ctx.set({
          phase: 'processing-error',
          problem: {
            kind: 'playback',
            message:
              'Uploaded to VideoDB. Playback or the recording name still needs to be checked.',
          },
        });
    } finally {
      completing.delete(payload.sessionId);
    }
  }
  function failed(sessionId, kind = 'upload') {
    const record = forSession(sessionId);
    if (!record) return;
    if (
      ctx.get().sessionId === sessionId &&
      ['starting', 'recording', 'paused', 'stopping'].includes(ctx.get().phase)
    ) {
      ctx.set({
        phase: 'stopped',
        problem: {
          kind: 'capture-unknown',
          message:
            'The local recording failed. Capture stop has not been confirmed; use Stop before starting again.',
        },
      });
    } else if (ctx.get().sessionId === sessionId)
      ctx.set({
        phase: 'processing-error',
        problem: {
          kind,
          message: record.videoId
            ? 'The upload finished, but playback needs another check.'
            : 'Saving did not finish. Retained complete recordings can be retried; incomplete media may need recovery.',
        },
      });
    ctx.update(record.id, {
      status: 'error',
      jobStage: record.videoId ? 'playback' : 'failed',
    });
  }
  async function event(name, payload) {
    const record = forSession(payload?.sessionId);
    if (!record) return;
    if (name === 'processing-complete') return complete(payload);
    if (name === 'local-recording-ready') {
      ctx.update(record.id, {
        recordingId: payload.recordingId,
        jobStage: 'awaiting_token',
      });
      schedule();
    }
    if (
      [
        'local-recording-failed',
        'recording-relay-failed',
        'recording-token-error',
      ].includes(name)
    )
      failed(payload.sessionId);
  }
  function schedule() {
    if (poll || disposed) return;
    poll = setTimeout(() => {
      poll = null;
      ctx.run(async () => {
        await recover(false);
        if (
          ctx
            .get()
            .recordings.some(
              (r) => !r.videoId && r.recordingId && r.status !== 'error',
            )
        )
          schedule();
      });
    }, 3000);
  }
  function wait(identity) {
    const key = identity.sessionId || identity.recordingId;
    if (waiting.has(key) || disposed) return;
    waiting.add(key);
    ctx.run(async () => {
      try {
        await complete(await recorder.wait(identity));
      } catch {
        failed(
          identity.sessionId ||
            ctx
              .get()
              .recordings.find((r) => r.recordingId === identity.recordingId)
              ?.sessionId,
        );
      } finally {
        waiting.delete(key);
      }
    });
    schedule();
  }
  async function recover(startWaits = true) {
    const scope = ctx.scope();
    const jobs = await recorder.recover();
    for (const job of jobs) {
      if (scope !== ctx.scope() || disposed) return;
      let record = forSession(job.sessionId);
      if (!record) {
        try {
          await service.ownsSession(job.sessionId);
        } catch {
          continue;
        }
        if (scope !== ctx.scope()) return;
        record = newRecord({
          id: `local-${randomUUID()}`,
          sessionId: job.sessionId,
          title: 'Recovered recording',
        });
        ctx.records([record, ...ctx.get().recordings]);
      }
      if (job.stage === 'complete' && job.result?.videoId) {
        await complete(job);
        continue;
      }
      if (record.videoId) continue;
      if (record.paused) {
        ctx.update(record.id, { recordingId: job.recordingId });
        continue;
      }
      const measuredDuration = Number(
        job.metadata?.duration_seconds ?? job.metadata?.durationSeconds,
      );
      ctx.update(record.id, {
        recordingId: job.recordingId,
        jobStage: job.stage,
        ...(Number.isFinite(measuredDuration) && measuredDuration > 0
          ? { duration: measuredDuration }
          : {}),
        status: job.stage === 'failed' ? 'error' : 'processing',
      });
      if (ctx.get().sessionId === job.sessionId && ctx.get().phase === 'saving')
        ctx.set({ upload: { stage: job.stage, progress: null } });
      if (startWaits && job.stage !== 'failed' && job.stage !== 'recording')
        wait({ recordingId: job.recordingId });
    }
  }
  async function retry(id) {
    if (
      ['starting', 'recording', 'paused', 'stopping'].includes(ctx.get().phase)
    )
      throw new ServiceError(
        'busy',
        'Finish the current capture before retrying an older upload.',
      );
    const record = ctx.find(id);
    if (!record) return;
    if (record.videoId) {
      const result = await service.reconcileRecording(record.videoId);
      if (result.reconciliationNeeded) return;
      await complete({
        sessionId: record.sessionId,
        recordingId: record.recordingId,
        result: { videoId: record.videoId },
      });
      return;
    }
    if (!record.recordingId) return recover();
    ctx.update(id, {
      paused: false,
      status: 'processing',
      jobStage: 'awaiting_token',
    });
    await recorder.relay(record.recordingId, record.sessionId);
    wait({ recordingId: record.recordingId });
  }
  return {
    event,
    wait,
    recover,
    retry,
    dispose() {
      disposed = true;
      clearTimeout(poll);
      poll = null;
    },
  };
}

module.exports = { createJobs };
