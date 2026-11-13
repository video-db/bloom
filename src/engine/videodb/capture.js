const { randomUUID } = require('node:crypto');
const { newRecord, datedTitle, canStart } = require('./model');
const { ServiceError, safeError } = require('./errors');

function createCapture(
  ctx,
  { service, recorder, jobs, now = () => performance.now() },
) {
  let clock = null;
  let startedAt = 0;
  let accumulated = 0;
  let transitioning = false;
  // When this capture began and where it was paused, in seconds from its start as the file
  // counts them. The file keeps running through a pause; these are what a later edit cuts.
  let began = 0;
  let pausedFrom = null;
  let pauses = [];
  const sinceBegan = () => Math.round((now() - began) / 100) / 10;
  function closePause() {
    if (pausedFrom === null) return;
    pauses = [...pauses, { from: pausedFrom, to: sinceBegan() }];
    pausedFrom = null;
    const record = ctx
      .get()
      .recordings.find((r) => r.sessionId === ctx.get().sessionId);
    if (record) ctx.update(record.id, { pauses });
  }
  const tracks = () => [
    'screen',
    ...(ctx.get().sources.mic ? ['mic'] : []),
    ...(ctx.get().sources.systemAudio ? ['system_audio'] : []),
  ];
  function freeze() {
    if (clock) accumulated += Math.max(0, now() - startedAt);
    clearInterval(clock);
    clock = null;
    ctx.set({ elapsed: Math.floor(accumulated / 1000) });
  }
  function tick() {
    startedAt = now();
    clearInterval(clock);
    clock = setInterval(
      () =>
        ctx.set({
          elapsed: Math.floor((accumulated + now() - startedAt) / 1000),
        }),
      1000,
    );
  }
  const commands = {
    async start() {
      const state = ctx.get();
      if (transitioning || !canStart(state)) return;
      if (state.account.status !== 'signed-in')
        throw new ServiceError(
          'signed-out',
          'Connect your VideoDB account first.',
        );
      const permissions = recorder.permissions();
      if (!permissions.screen || (state.sources.mic && !permissions.mic))
        throw new ServiceError(
          'permission',
          'Allow the selected recording sources in System Settings first.',
        );
      const display = state.channels.displays.find(
        (c) => c.id === state.sources.screen,
      );
      const mic = state.channels.mics.find(
        (c) => c.id === state.sources.microphone,
      );
      const video = state.sources.window || display?.id;
      if (
        !video ||
        (state.sources.mic && !mic) ||
        (state.sources.systemAudio && !state.channels.systemAudio.length)
      )
        throw new ServiceError(
          'source',
          'A selected recording source is unavailable. Choose it again.',
        );
      transitioning = true;
      const operationId = randomUUID();
      ctx.set({
        phase: 'starting',
        upload: null,
        operationId,
        sessionId: `starting-${operationId}`,
        elapsed: 0,
        marks: [],
        result: null,
        problem: null,
      });
      let sessionId = null;
      let record = null;
      let attempted = false,
        started = false;
      try {
        // Standalone recording has no backend session: the id is Bloom's own, and nothing
        // is asked of VideoDB before capture begins.
        sessionId = `rec-${operationId}`;
        const title = state.purpose || datedTitle(new Date());
        record = newRecord({ id: `local-${operationId}`, sessionId, title });
        record.requestedTitle = title; // VideoDB gets the same name
        ctx.records([record, ...ctx.get().recordings]);
        ctx.set({ sessionId });
        const channels = [
          {
            channelId: video,
            type: 'video',
            isPrimary: true,
            store: false,
          },
          ...(state.sources.mic
            ? [{ channelId: mic.id, type: 'audio', store: false }]
            : []),
          ...(state.sources.systemAudio
            ? [
                {
                  channelId: state.channels.systemAudio[0].id,
                  type: 'audio',
                  store: false,
                },
              ]
            : []),
        ];
        attempted = true;
        await recorder.start({ sessionId, channels, title });
        started = true;
        accumulated = 0;
        began = now();
        pausedFrom = null;
        pauses = [];
        ctx.set({ phase: 'recording' });
        tick();
        ctx.update(record.id, { jobStage: 'recording' });
      } catch (error) {
        const safe = safeError(error);
        ctx.set({
          phase: started ? 'recording' : attempted ? 'stopped' : 'idle',
          problem: {
            kind: attempted && !started ? 'capture-unknown' : safe.code,
            message:
              attempted && !started
                ? 'Recording startup was not confirmed. Capture status must be checked before another start.'
                : safe.message,
          },
        });
        if (record && !started) {
          try {
            ctx.update(record.id, {
              status: 'error',
              jobStage: 'start-unknown',
            });
          } catch {
            /* The native journal remains independent of this cache failure. */
          }
        }
        throw error;
      } finally {
        transitioning = false;
      }
    },
    async stop() {
      if (
        transitioning ||
        !['recording', 'paused', 'stopped'].includes(ctx.get().phase)
      )
        return;
      transitioning = true;
      let confirmed = false;
      ctx.set({ phase: 'stopping', problem: null });
      try {
        await recorder.stop();
        confirmed = true;
        closePause(); // stopped while paused: the pause runs to the end
        freeze();
        const record = ctx
          .get()
          .recordings.find((r) => r.sessionId === ctx.get().sessionId);
        if (record?.status === 'ready' && record.videoId) {
          ctx.set({
            phase: 'finished',
            upload: null,
            result: {
              id: record.id,
              title: record.title,
              duration: record.duration,
              stage: 0,
            },
          });
          return;
        }
        if (record)
          ctx.update(record.id, {
            duration: ctx.get().elapsed,
            marks: ctx.get().marks,
            jobStage: 'finalizing',
            status: 'processing',
          });
        ctx.set({
          phase: 'saving',
          upload: { stage: 'finalizing', progress: null },
        });
        jobs.wait({ sessionId: ctx.get().sessionId });
      } catch (error) {
        freeze();
        if (confirmed) {
          const safe = safeError(error);
          ctx.set({
            phase: 'saving',
            upload: { stage: 'finalizing', progress: null },
            problem: { kind: safe.code, message: safe.message },
          });
          jobs.wait({ sessionId: ctx.get().sessionId });
          return;
        }
        ctx.set({
          phase: 'stopped',
          problem: {
            kind: 'capture-unknown',
            message:
              'Stop was not confirmed. Capture may still be running. Try Stop again.',
          },
        });
      } finally {
        transitioning = false;
      }
    },
    async pause() {
      if (transitioning || ctx.get().phase !== 'recording') return;
      transitioning = true;
      try {
        await recorder.pause(tracks());
        pausedFrom = sinceBegan();
        freeze();
        ctx.set({ phase: 'paused' });
      } catch {
        ctx.set({
          problem: {
            kind: 'pause-failed',
            message:
              'Pause was not confirmed for every source. Recording may still be active; use Stop.',
          },
        });
      } finally {
        transitioning = false;
      }
    },
    async resume() {
      if (transitioning || ctx.get().phase !== 'paused') return;
      transitioning = true;
      try {
        await recorder.resume(tracks());
        closePause();
        ctx.set({ phase: 'recording', problem: null });
        tick();
      } catch {
        ctx.set({
          phase: 'stopped',
          problem: {
            kind: 'capture-unknown',
            message:
              'Resume was not confirmed. Some sources may be active; use Stop.',
          },
        });
      } finally {
        transitioning = false;
      }
    },
    mark({ text = '' }) {
      if (ctx.get().phase !== 'recording') return;
      const marks = [
        ...ctx.get().marks,
        { at: ctx.get().elapsed, text: text.trim() || 'Marked moment' },
      ];
      const record = ctx
        .get()
        .recordings.find((r) => r.sessionId === ctx.get().sessionId);
      if (record) ctx.update(record.id, { marks });
      ctx.set({ marks });
    },
    newRecording() {
      if (['finished', 'processing-error'].includes(ctx.get().phase))
        ctx.set({
          phase: 'idle',
          result: null,
          elapsed: 0,
          marks: [],
          purpose: '',
          sessionId: null,
          problem: null,
        });
    },
  };
  return {
    commands,
    observedStop(sessionId) {
      if (
        sessionId !== ctx.get().sessionId ||
        !['recording', 'paused', 'stopped'].includes(ctx.get().phase)
      )
        return;
      freeze();
      const record = ctx
        .get()
        .recordings.find((r) => r.sessionId === sessionId);
      if (record)
        ctx.update(record.id, {
          duration: ctx.get().elapsed,
          marks: ctx.get().marks,
          jobStage: 'finalizing',
        });
      ctx.set({
        phase: 'saving',
        upload: { stage: 'finalizing', progress: null },
        problem: null,
      });
      jobs.wait({ sessionId });
    },
    dispose() {
      clearInterval(clock);
      clock = null;
    },
  };
}

module.exports = { createCapture };
