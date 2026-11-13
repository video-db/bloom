// Reading the account beyond Bloom's own recordings: its balance, its collections, another
// collection's videos, and a search across what was said. Nothing here changes anything in
// VideoDB.
const { ServiceError } = require('./errors');
const { recording, requireId } = require('./library');

const unreadable = (what) =>
  new ServiceError('invalid-response', `VideoDB returned ${what}. Try again.`);

function createExplore({ account, read }) {
  return {
    // The credit balance as VideoDB reports it.
    async usage() {
      const scope = account();
      const usage = await read(scope, () => scope.conn.checkUsage());
      const credits = Number(usage?.creditBalance);
      if (usage?.creditBalance == null || !Number.isFinite(credits))
        throw unreadable('an unreadable balance');
      return { credits };
    },
    // Every collection in the account; `bloom` marks the one Bloom records into.
    async listCollections() {
      const scope = account();
      const collections = await read(scope, () => scope.conn.getCollections());
      if (!Array.isArray(collections))
        throw unreadable('an unreadable library');
      return collections
        .filter(
          (c) =>
            typeof c?.id === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(c.id),
        )
        .map((c) => ({
          id: c.id,
          name:
            typeof c.name === 'string' && c.name.trim()
              ? c.name.trim().slice(0, 120)
              : 'Untitled collection',
          bloom: c.id === scope.collection?.id,
        }));
    },
    async listCollectionVideos(collectionId) {
      const scope = account();
      const coll = await read(scope, () =>
        scope.conn.getCollection(requireId(collectionId)),
      );
      const videos = await read(scope, () => coll.getVideos());
      if (!Array.isArray(videos)) throw unreadable('an unreadable collection');
      return videos.map(recording);
    },
    // Moments where something like `query` was said, across Bloom's transcribed recordings.
    async search(query) {
      if (typeof query !== 'string' || !query.trim() || query.length > 300)
        throw new ServiceError('invalid-input', 'Type what to look for.');
      const scope = account();
      if (!scope.collection) return [];
      let result;
      try {
        result = await read(scope, () =>
          scope.collection.legacySearch(query.trim()),
        );
      } catch (error) {
        // VideoDB reports an empty answer as an error; it is no moments, not a failure.
        if (/no results found/i.test(String(error?.message))) return [];
        throw error;
      }
      if (!Array.isArray(result?.shots))
        throw unreadable('an unreadable search result');
      const shots = result.shots;
      return shots
        .filter(
          (s) =>
            typeof s?.videoId === 'string' &&
            Number.isFinite(s.start) &&
            Number.isFinite(s.end) &&
            s.start >= 0 &&
            s.end >= s.start,
        )
        .map((s) => ({
          videoId: s.videoId,
          start: s.start,
          end: s.end,
          text: typeof s.text === 'string' ? s.text.trim().slice(0, 600) : '',
        }));
    },
  };
}

module.exports = { createExplore };
