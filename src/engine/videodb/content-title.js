// Only automatic date names are eligible; a user's rename always takes precedence.
async function applyContentTitle(ctx, service, id, title, originalTitle) {
  const record = ctx.find(id);
  if (
    !title ||
    !record?.videoId ||
    record.readOnly ||
    record.pendingOperation ||
    record.titleOrigin === 'user' ||
    record.titleOrigin === 'content' ||
    record.titleAttempted ||
    record.title !== originalTitle ||
    !/^Recording · /.test(record.title)
  )
    return;
  const scope = ctx.scope();
  ctx.update(id, { titleAttempted: true, pendingOperation: 'rename' });
  try {
    const renamed = await service.rename(record.videoId, title);
    if (scope !== ctx.scope()) return;
    ctx.update(id, {
      title: renamed.title,
      requestedTitle: renamed.title,
      titleOrigin: 'content',
      pendingOperation: null,
    });
    if (ctx.get().result?.id === id)
      ctx.set({ result: { ...ctx.get().result, title: renamed.title } });
  } catch (error) {
    if (scope === ctx.scope())
      ctx.update(id, { pendingOperation: error.uncertain ? 'rename' : null });
    // The summary is still usable when saving its suggested title fails.
    throw error;
  }
}

module.exports = { applyContentTitle };
