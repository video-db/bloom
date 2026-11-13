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
    ctx.set({
      ...(collections.status === 'fulfilled'
        ? {
            // Bloom's own collection first, then by name.
            collections: collections.value.sort(
              (a, b) => b.bloom - a.bloom || a.name.localeCompare(b.name),
            ),
          }
        : {}),
      ...(usage.status === 'fulfilled' ? { credits: usage.value.credits } : {}),
    });
  }
  const browsing = (id) => ctx.get().browsing?.id === id;
  const commands = {
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
      const query = text.trim();
      if (!query) return ctx.set({ search: noSearch() });
      ctx.set({ search: { query, status: 'searching', results: [] } });
      try {
        const found = await service.search(query);
        if (ctx.get().search.query !== query) return;
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
        if (ctx.get().search.query === query)
          ctx.set({ search: { query, status: 'error', results: [] } });
        throw error;
      }
    },
  };
  return { overview, commands, cleared };
}

module.exports = { createExploreCommands };
