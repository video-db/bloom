// Turning a recording's transcript into something to act on: its summary, made once and kept.
function createUnderstandCommands(ctx, service) {
  async function summarise({ id }) {
    const record = ctx.find(id);
    if (!record?.transcript || record.summaryStatus === 'working') return;
    // Without word timings there is one paragraph, at the start.
    const paragraphs = record.paragraphs?.length
      ? record.paragraphs
      : [{ at: 0, text: record.transcript }];
    ctx.update(id, { summaryStatus: 'working' });
    try {
      const summary = await service.summarise(paragraphs);
      ctx.update(id, { summary, summaryStatus: 'ready' });
    } catch (error) {
      ctx.update(id, { summaryStatus: 'error' });
      throw error;
    }
  }
  return {
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
