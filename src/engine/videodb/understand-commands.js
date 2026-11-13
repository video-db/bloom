const { applyContentTitle } = require('./content-title');
// Turning a recording's transcript into something to act on: its summary, made once and kept.
function createUnderstandCommands(ctx, service) {
  const naming = new Map();
  async function summarise({ id }) {
    const scope = ctx.scope();
    const record = ctx.find(id);
    if (!record?.transcript || record.summaryStatus === 'working') return;
    // Without word timings there is one paragraph, at the start.
    const paragraphs = record.paragraphs?.length
      ? record.paragraphs
      : [{ at: 0, text: record.transcript }];
    ctx.update(id, { summaryStatus: 'working' });
    try {
      const summary = await service.summarise(paragraphs);
      if (scope !== ctx.scope()) return;
      ctx.update(id, { summary, summaryStatus: 'ready' });
    } catch (error) {
      if (scope === ctx.scope()) ctx.update(id, { summaryStatus: 'error' });
      throw error;
    }
    const task = applyContentTitle(
      ctx,
      service,
      id,
      ctx.find(id)?.summary?.title,
      record.title,
    );
    naming.set(id, task);
    try {
      await task;
    } finally {
      naming.delete(id);
    }
  }
  return {
    whenNamed: (id) => naming.get(id) || Promise.resolve(),
    commands: { summarise },
    // After a recording is opened: make its summary if it has a transcript and none yet.
    async ensure(id) {
      const record = ctx.find(id);
      if (record?.transcript && !record.summary && !record.summaryStatus)
        await summarise({ id });
    },
  };
}

module.exports = { createUnderstandCommands };
