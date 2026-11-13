const { ServiceError } = require('./errors');

function requireId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(value))
    throw new ServiceError(
      'invalid-input',
      'Select a recording and try again.',
    );
  return value;
}

function mediaUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function recording(video) {
  if (!video || typeof video !== 'object')
    throw new ServiceError(
      'invalid-response',
      'VideoDB returned an unreadable recording. Try again.',
    );
  const duration = Number(video.length);
  return {
    id: requireId(video.id),
    title:
      typeof video.name === 'string' && video.name
        ? video.name
        : 'Untitled recording',
    duration: Number.isFinite(duration) && duration >= 0 ? duration : 0,
    streamUrl: mediaUrl(video.streamUrl),
    playerUrl: mediaUrl(video.playerUrl),
  };
}

function createLibrary({ account, read, assertCurrent, operations, journal }) {
  const { mutate } = operations;
  async function collection(scope) {
    assertCurrent(scope);
    if (!scope.collection)
      throw new ServiceError(
        'collection-missing',
        'Create your Bloom collection before recording.',
      );
    return scope.collection;
  }
  async function video(scope, id) {
    const coll = await collection(scope);
    return read(scope, () => coll.getVideo(requireId(id)));
  }
  return {
    async listRecordings() {
      const scope = account();
      if (!scope.collection) return [];
      const videos = await read(scope, () => scope.collection.getVideos());
      if (!Array.isArray(videos))
        throw new ServiceError(
          'invalid-response',
          'VideoDB returned an unreadable library. Try again.',
        );
      return videos.map(recording);
    },
    async getPlayback(id) {
      const scope = account();
      const item = await video(scope, id);
      return recording(item);
    },
    async rename(id, title) {
      requireId(id);
      if (typeof title !== 'string' || !title.trim() || title.length > 180)
        throw new ServiceError(
          'invalid-input',
          'Use a recording title between 1 and 180 characters.',
        );
      const scope = account();
      const item = await video(scope, id);
      return mutate(
        scope,
        `video:${id}`,
        { kind: 'rename', title: title.trim() },
        async () => {
          await item.update({ name: title.trim() });
          return recording(item);
        },
      );
    },
    async deleteRecording(id) {
      requireId(id);
      const scope = account();
      const item = await video(scope, id);
      return mutate(scope, `video:${id}`, { kind: 'delete' }, async () => {
        await item.delete();
        return { id, deleted: true };
      });
    },
    async reconcileRecording(id) {
      requireId(id);
      const scope = account();
      const key = `video:${id}`;
      const entry = operations.getUncertain(scope, key);
      let result;
      try {
        result = { exists: true, recording: recording(await video(scope, id)) };
      } catch (error) {
        if (error.code !== 'not-found') throw error;
        result = { exists: false, recording: null };
      }
      const confirmed =
        entry &&
        ((entry.kind === 'delete' && !result.exists) ||
          (entry.kind === 'rename' && result.recording?.title === entry.title));
      if (confirmed) {
        operations.confirm(scope, key);
      }
      return { ...result, reconciliationNeeded: !!entry && !confirmed };
    },
    async transcript(id) {
      const scope = account();
      const item = await video(scope, id);
      const result = await read(scope, () =>
        item.getTranscript(undefined, undefined, 'word'),
      );
      if (
        typeof result?.text !== 'string' ||
        !Array.isArray(result.wordTimestamps)
      )
        throw new ServiceError(
          'invalid-response',
          'The transcript is not ready. Try again shortly.',
        );
      const pendingIndex = operations.getUncertain(scope, `index:${id}`);
      if (result.text.trim() && pendingIndex) {
        operations.confirmIndex(scope, pendingIndex);
      }
      // An empty response alone cannot establish whether indexing completed without speech.
      return {
        status: result.text.trim() ? 'ready' : 'empty',
        text: result.text,
        words: result.wordTimestamps
          .filter(
            (word) =>
              typeof word?.word === 'string' &&
              Number.isFinite(word.start) &&
              Number.isFinite(word.end) &&
              word.start >= 0 &&
              word.end >= word.start,
          )
          .map(({ word, start, end }) => ({ word, start, end })),
      };
    },
    async requestTranscript(id) {
      requireId(id);
      const scope = account();
      const key = `index:${id}`;
      if (
        journal
          .list(scope.id)
          .some((item) => item.key === key && item.state === 'confirmed')
      )
        return { requested: true };
      return mutate(scope, key, { kind: 'index' }, async () => {
        const item = await video(scope, id);
        const result = await item.indexSpokenWords();
        if (result?.success !== true)
          throw new ServiceError(
            'indexing',
            'Transcript preparation was not accepted. Try again.',
          );
        return { requested: true };
      });
    },
    async prepareDownload(id) {
      const scope = account();
      const item = await video(scope, id);
      // Preparing a transient download does not change the recording; retries remain user initiated.
      return read(scope, async () => {
        const result = await item.download();
        const url = mediaUrl(result?.url || result?.downloadUrl);
        if (!url)
          throw new ServiceError(
            'invalid-response',
            'The download is not ready. Try again shortly.',
          );
        return { url, name: `${id}.mp4` };
      });
    },
  };
}

module.exports = { createLibrary, mediaUrl };
