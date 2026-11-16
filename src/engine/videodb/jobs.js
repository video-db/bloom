const { randomUUID } = require('node:crypto');
const { newRecord, unfinished } = require('./model');

const CAPTURING = ['starting', 'recording', 'paused', 'stopping', 'stopped'];
const { ServiceError } = require('./errors');

function createJobs(ctx, { service, recorder, onReady = () => {} }) {
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
    if (!record) return;
    if (
      record.videoId === payload.result.videoId &&
      record.status === 'ready'
    ) {
      // Already playable: only its file may still be waiting to be cleared away.
      recorder.discard?.(payload.recordingId);
      return;
    }
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
        title: record.requestedTitle || video.title,
        duration: video.duration || record.duration,
      });
      // It plays from VideoDB now, so the file that got it there is deleted (ADR 0006).
      recorder.discard?.(payload.recordingId);
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
      onReady(record.id);
      continueSetAside();
    } catch {
      if (scope !== ctx.scope()) return;
      ctx.update(record.id, { status: 'error', jobStage: 'playback' });
      if (ctx.get().sessionId === payload.sessionId)
        ctx.set({
          phase: 'processing-error',
          problem: {
            kind: 'playback',
            message:
              'Processed. Playback or the recording name still needs to be checked.',
          },
        });
    } finally {
      completing.delete(payload.sessionId);
    }
  }
  function failed(sessionId, kind = 'processing') {
    const record = forSession(sessionId);
    // A set-aside recording's old wait ends when the recorder restarts; that is not a failure.
    if (!record || record.paused) return;
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
            ? 'Processing finished, but playback needs another check.'
            : 'Processing did not finish. Recover the recording to try again.',
        },
      });
    ctx.update(record.id, {
      status: 'error',
      jobStage: record.videoId ? 'playback' : 'failed',
    });
    continueSetAside();
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
              (r) =>
                !r.videoId &&
                r.recordingId &&
                r.status !== 'error' &&
                !r.paused,
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
        // The recorder lists only this account's files; one with no record is recovered.
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
    if (startWaits) continueSetAside();
  }
  async function retry(id) {
    if (
      ['starting', 'recording', 'paused', 'stopping'].includes(ctx.get().phase)
    )
      throw new ServiceError(
        'busy',
        'Finish the current recording before recovering an older one.',
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
      continueLater: false,
      status: 'processing',
      jobStage: 'awaiting_token',
    });
    // Recovering the recording just made: it is being processed again, not failed.
    if (
      record.sessionId === ctx.get().sessionId &&
      ctx.get().phase === 'processing-error'
    )
      ctx.set({ phase: 'saving', problem: null });
    await recorder.relay(record.recordingId, record.sessionId);
    wait({ recordingId: record.recordingId });
  }
  // Before a new recording starts: every unfinished earlier recording is set aside. One that
  // was being processed is marked to continue afterwards; a failed one waits to be recovered.
  function setAside(startingId) {
    for (const record of ctx
      .get()
      .recordings.filter((r) => r.id !== startingId && unfinished(r)))
      ctx.update(record.id, {
        paused: true,
        continueLater: record.continueLater || record.status !== 'error',
        jobStage: record.status === 'error' ? 'paused-upload' : 'waiting',
      });
  }
  // When nothing is being captured: pick up the recordings set aside while they were going well.
  function continueSetAside() {
    if (disposed || CAPTURING.includes(ctx.get().phase)) return;
    for (const record of ctx
      .get()
      .recordings.filter((r) => r.paused && r.continueLater && unfinished(r))) {
      ctx.update(record.id, { continueLater: false });
      ctx.run(() => retry(record.id));
    }
  }
  return {
    event,
    wait,
    recover,
    retry,
    setAside,
    continueSetAside,
    dispose() {
      disposed = true;
      clearTimeout(poll);
      poll = null;
    },
  };
}

module.exports = { createJobs };
