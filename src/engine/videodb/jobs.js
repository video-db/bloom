const { randomUUID } = require('node:crypto');
const { newRecord, unfinished } = require('./model');

const CAPTURING = ['starting', 'recording', 'paused', 'stopping', 'stopped'];
const { ServiceError } = require('./errors');

// A recording that could not be processed on the connection is tried again by itself:
// after one, five and fifteen minutes, then every half hour, and at every launch.
const RETRY_MINUTES = [1, 5, 15, 30];
// Stages this run knows more precisely than the recorder's list does.
const KNOWN_STAGES = ['sending', 'registering', 'waiting-connection', 'playback'];

function createJobs(
  ctx,
  {
    service,
    recorder,
    onReady = () => {},
    retryDelay = (attempt) =>
      RETRY_MINUTES[Math.min(attempt, RETRY_MINUTES.length - 1)] * 60 * 1000,
  },
) {
  const waiting = new Set();
  const completing = new Set();
  const later = new Map(); // record id -> { timer, attempt } for the next try
  let poll = null;
  let disposed = false;

  function tryLater(id) {
    // A failure is often heard twice (the event and the wait); one next try is enough.
    if (disposed || !ctx.find(id) || later.get(id)?.pending) return;
    const attempt = later.has(id) ? later.get(id).attempt + 1 : 0;
    const timer = setTimeout(() => {
      later.get(id).pending = false;
      ctx.run(async () => {
        try {
          await retry(id);
        } catch {
          tryLater(id); // still capturing, or the connection again: the next try
        }
      });
    }, retryDelay(attempt));
    timer.unref?.();
    later.set(id, { timer, attempt, pending: true });
  }
  function settled(id) {
    clearTimeout(later.get(id)?.timer);
    later.delete(id);
  }
  // The connection let a recording down: it waits for a better one, and nothing blocks.
  function waitForConnection(identity) {
    const record = forJob(identity);
    if (!record || record.paused) return;
    const { sessionId } = record;
    ctx.update(record.id, {
      status: 'processing',
      jobStage: 'waiting-connection',
      progress: null,
    });
    if (
      ctx.get().sessionId === sessionId &&
      ['saving', 'processing-error'].includes(ctx.get().phase)
    )
      ctx.set({ phase: 'idle', problem: null, upload: null });
    tryLater(record.id);
  }

  function forSession(sessionId) {
    return ctx.get().recordings.find((r) => r.sessionId === sessionId);
  }
  // The recorder names a recording by its id; Bloom's own session id is known only to the
  // run that started it.
  const forJob = ({ recordingId, sessionId } = {}) =>
    (recordingId &&
      ctx.get().recordings.find((r) => r.recordingId === recordingId)) ||
    (sessionId && forSession(sessionId));
  async function complete(payload) {
    const record = payload?.result?.videoId && forJob(payload);
    if (!record || completing.has(record.sessionId)) return;
    if (record.videoId === payload.result.videoId && record.status === 'ready')
      return;
    const sessionId = record.sessionId;
    completing.add(sessionId);
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
        progress: null,
        streamUrl: video.streamUrl,
        playerUrl: video.playerUrl,
        title: record.requestedTitle || video.title,
        duration: video.duration || record.duration,
      });
      if (ctx.get().sessionId === sessionId) {
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
      settled(record.id);
      onReady(record.id);
      continueSetAside();
    } catch {
      if (scope !== ctx.scope()) return;
      // In VideoDB, but playback is not confirmed yet: checked again by itself.
      ctx.update(record.id, { status: 'processing', jobStage: 'playback' });
      tryLater(record.id);
    } finally {
      completing.delete(sessionId);
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
          message: 'This recording can’t be processed.',
        },
      });
    ctx.update(record.id, {
      status: 'error',
      jobStage: record.videoId ? 'playback' : 'failed',
    });
    continueSetAside();
  }
  async function event(name, payload) {
    const record = forJob(payload);
    if (!record) return;
    if (name === 'processing-complete') return complete(payload);
    if (name === 'recording-progress') {
      ctx.update(record.id, {
        status: 'processing',
        jobStage: payload.progress >= 1 ? 'registering' : 'sending',
        progress: payload.progress,
      });
      return;
    }
    if (name === 'local-recording-ready') {
      ctx.update(record.id, {
        recordingId: payload.recordingId,
        jobStage: 'awaiting_token',
      });
      schedule();
    }
    if (
      ['recording-relay-failed', 'recording-token-error'].includes(name) &&
      !payload.permanent
    )
      return waitForConnection(payload);
    if (
      [
        'local-recording-failed',
        'recording-relay-failed',
        'recording-token-error',
      ].includes(name)
    )
      failed(record.sessionId);
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
      } catch (error) {
        if (error?.permanent || error?.code === 'not-found')
          failed(forJob(identity)?.sessionId);
        else waitForConnection(identity);
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
      let record = forJob(job);
      if (!record) {
        // Already in VideoDB, where the library finds it; Bloom may have deleted it since.
        if (job.stage === 'complete') continue;
        // The recorder lists only this account's recordings; one with no record is recovered.
        record = newRecord({
          id: `local-${randomUUID()}`,
          sessionId: job.sessionId || `recovered-${job.recordingId}`,
          title: 'Recovered recording',
        });
        record.recordingId = job.recordingId;
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
      // The recorder lists a recording being sent, or waiting to be, as plain processing.
      // What this run already knows (how far the send has got, or that it waits for a
      // better connection) is kept, or the poll every few seconds would wipe it.
      const known =
        job.stage === 'processing' && KNOWN_STAGES.includes(record.jobStage);
      ctx.update(record.id, {
        recordingId: job.recordingId,
        ...(known ? {} : { jobStage: job.stage }),
        // A Bloom opened while the recorder delivers shows how far it has got at once.
        ...(Number.isFinite(job.progress) && !known
          ? { jobStage: 'sending', progress: job.progress }
          : {}),
        ...(Number.isFinite(measuredDuration) && measuredDuration > 0
          ? { duration: measuredDuration }
          : {}),
        status: job.stage === 'failed' ? 'error' : 'processing',
      });
      if (
        ctx.get().sessionId === record.sessionId &&
        ctx.get().phase === 'saving'
      )
        ctx.set({ upload: { stage: job.stage, progress: null } });
      if (startWaits && job.stage !== 'failed' && job.stage !== 'recording')
        wait({ recordingId: job.recordingId });
    }
    // Unfinished here but unknown to the recorder: made before the recorder sent recordings
    // itself. It will not finish by itself, so it is shown as needing recovery.
    if (scope !== ctx.scope() || disposed) return;
    const listed = new Set(jobs.map((job) => job.recordingId));
    for (const record of ctx.get().recordings)
      if (
        record.recordingId &&
        !record.videoId &&
        record.status !== 'error' &&
        !record.paused &&
        !listed.has(record.recordingId) &&
        record.sessionId !== ctx.get().sessionId
      )
        ctx.update(record.id, { status: 'error', jobStage: 'failed' });
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
  // An earlier build set unfinished recordings aside while a new one was made. Nothing
  // does that now (ADR 0004), but one set aside then is still picked up here.
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
    continueSetAside,
    dispose() {
      disposed = true;
      clearTimeout(poll);
      poll = null;
      for (const id of [...later.keys()]) settled(id);
    },
  };
}

module.exports = { createJobs };
