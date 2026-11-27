// What the app knows about the account beyond its own recordings: collections, the balance,
// the collection being browsed and the last search. Read-only: a browsed collection's videos
// can be played and read, never changed.
const { newRecord } = require('./model');

const noSearch = () => ({ query: '', status: 'idle', results: [] }); // idle | searching | ready | error
const cleared = () => ({
  collections: [],
  credits: null,
  browsing: null,
  search: noSearch(),
});

function createExploreCommands(ctx, service) {
  // Collections and balance for the sidebar. Either may fail without failing the other, and
  // neither stops the library from loading.
  async function overview() {
    const scope = ctx.scope();
    const [collections, usage] = await Promise.allSettled([
      service.listCollections(),
      service.usage(),
    ]);
    if (scope !== ctx.scope()) return;
    // Keep an uncertain deletion reachable even when the server no longer lists it.
    if (collections.status === 'fulfilled') {
      for (const op of service
        .pendingOperations()
        .filter((op) => op.key.startsWith('collection:'))) {
        const id = op.key.slice('collection:'.length);
        if (!collections.value.some((c) => c.id === id))
          collections.value.push(
            ctx.get().collections.find((c) => c.id === id) || {
              id,
              name: op.title || 'Collection awaiting confirmation',
              bloom: false,
            },
          );
      }
    }
    ctx.set({
      ...(collections.status === 'fulfilled'
        ? {
            // Bloom's own collection first, then by name.
            collections: collections.value
              .map((c) => ({
                ...c,
                pendingOperation:
                  service
                    .pendingOperations()
                    .find((op) => op.key === `collection:${c.id}`) || null,
              }))
              .sort(
                (a, b) => b.bloom - a.bloom || a.name.localeCompare(b.name),
              ),
          }
        : {}),
      ...(usage.status === 'fulfilled' ? { credits: usage.value.credits } : {}),
    });
  }
  const browsing = (id) => ctx.get().browsing?.id === id;
  const changing = new Set();
  let searchVersion = 0;
  async function change(action, id, text) {
    const scope = ctx.scope();
    const target = ctx.get().collections.find((c) => c.id === id);
    if (!target || target.bloom || changing.has(id)) return;
    changing.add(id);
    ctx.set({ problem: null, notice: '' });
    try {
      const result = await service[action](id, text);
      if (scope !== ctx.scope()) return;
      if (action === 'renameCollection' && browsing(id))
        ctx.set({ browsing: { ...ctx.get().browsing, name: text.trim() } });
      if (action === 'deleteCollection' && browsing(id))
        ctx.set({ browsing: null });
      if (result?.reconciliationNeeded)
        ctx.set({
          notice:
            'The previous change is not confirmed yet. Check again before making another change.',
        });
      else
        ctx.set({
          notice:
            action === 'renameCollection'
              ? 'Collection renamed.'
              : action === 'deleteCollection'
                ? 'Collection deleted.'
                : 'Previous change confirmed.',
        });
    } finally {
      changing.delete(id);
      if (scope === ctx.scope()) {
        await overview();
        const opened = ctx.get().browsing;
        if (opened) {
          const collection = ctx
            .get()
            .collections.find((c) => c.id === opened.id);
          ctx.set({
            browsing: collection ? { ...opened, name: collection.name } : null,
          });
        }
      }
    }
  }
  const commands = {
    renameCollection: ({ id, text }) => change('renameCollection', id, text),
    deleteCollection: ({ id }) => change('deleteCollection', id),
    reconcileCollectionAction: ({ id }) =>
      change('reconcileCollectionAction', id),
    async openCollection({ id }) {
      const target = ctx.get().collections.find((c) => c.id === id);
      // Bloom's own collection is the Recordings place itself.
      if (!target || target.bloom) return ctx.set({ browsing: null });
      const base = { id, name: target.name, recordings: [] };
      ctx.set({ browsing: { ...base, status: 'loading' } });
      try {
        const videos = await service.listCollectionVideos(id);
        if (!browsing(id)) return;
        ctx.set({
          browsing: {
            ...base,
            status: 'ready',
            recordings: videos.map((video) => ({
              ...newRecord({ id: video.id, title: video.title }),
              ...video,
              videoId: video.id,
              collectionId: id,
              readOnly: true,
              createdAt: null, // VideoDB does not say when it was made
              status: video.streamUrl ? 'ready' : 'processing',
            })),
          },
        });
      } catch (error) {
        if (browsing(id)) ctx.set({ browsing: { ...base, status: 'error' } });
        throw error;
      }
    },
    closeCollection() {
      ctx.set({ browsing: null });
    },
    async search({ text }) {
      const version = ++searchVersion;
      const scope = ctx.scope();
      const current = () => version === searchVersion && scope === ctx.scope();
      const query = text.trim();
      if (!query) return ctx.set({ search: noSearch() });
      ctx.set({ search: { query, status: 'searching', results: [] } });
      try {
        const found = await service.search(query);
        if (!current()) return;
        const records = ctx.get().recordings;
        ctx.set({
          search: {
            query,
            status: 'ready',
            // Only moments in recordings this window can open.
            results: found.flatMap((moment) => {
              const record = records.find((r) => r.videoId === moment.videoId);
              return record
                ? [{ ...moment, id: record.id, title: record.title }]
                : [];
            }),
          },
        });
      } catch (error) {
        if (!current()) return;
        ctx.set({ search: { query, status: 'error', results: [] } });
        throw error;
      }
    },
  };
  return { overview, commands, cleared };
}

module.exports = { createExploreCommands };
