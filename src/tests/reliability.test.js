const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLibraryCommands } = require('../engine/videodb/library-commands');
const { createExploreCommands } = require('../engine/videodb/explore-commands');
const { recording } = require('../engine/videodb/library');

function library() {
  const record = {
    id: 'r1',
    videoId: 'v1',
    transcript: '',
    transcriptStatus: 'not-requested',
  };
  const ctx = {
    scope: () => 'account',
    find: () => record,
    update: (_, patch) => Object.assign(record, patch),
  };
  const service = {
    getPlayback: async () => ({
      streamUrl: 'https://stream.example/video',
      playerUrl: 'https://player.example/video',
    }),
    transcript: async () => ({
      text: 'Hello',
      status: 'ready',
      words: [{ word: 'Hello', start: 1, end: 2 }],
    }),
    requestTranscript: async () => {},
  };
  return { record, service, commands: createLibraryCommands(ctx, service) };
}

test('transcript loads even when playback fails, and cached text survives empty or failed refresh', async () => {
  const { record, service, commands } = library();
  service.getPlayback = async () => {
    throw new Error('playback unavailable');
  };
  await assert.rejects(commands.open('r1'));
  assert.equal(record.transcript, 'Hello');
  assert.deepEqual(record.paragraphs, [{ at: 1, text: 'Hello' }]);
  service.transcript = async () => ({ text: '', status: 'empty', words: [] });
  await assert.rejects(commands.open('r1'));
  assert.equal(record.transcript, 'Hello');
  service.transcript = async () => {
    throw new Error('offline');
  };
  await assert.rejects(commands.open('r1'));
  assert.equal(record.transcriptStatus, 'ready');
});

test('failed transcript preparation exits processing and uncertain requests use read-only retry', async () => {
  const { record, service, commands } = library();
  service.requestTranscript = async () => {
    throw Object.assign(new Error('failed'), { uncertain: false });
  };
  await assert.rejects(commands.commands.requestTranscript({ id: 'r1' }));
  assert.equal(record.transcriptStatus, 'not-requested');
  service.requestTranscript = async () => {
    throw Object.assign(new Error('delayed'), { uncertain: true });
  };
  await assert.rejects(commands.commands.requestTranscript({ id: 'r1' }));
  assert.equal(record.transcriptStatus, 'error');
  await commands.open('r1');
  assert.equal(record.transcriptStatus, 'ready');
});

test('search ignores stale successes and failures even for the same query', async () => {
  let state = {
    search: {},
    recordings: [{ id: 'r1', videoId: 'v1', title: 'Recording' }],
  };
  const requests = [];
  const ctx = {
    scope: () => 'account',
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
    },
  };
  const service = {
    search: () =>
      new Promise((resolve, reject) => requests.push({ resolve, reject })),
  };
  const { commands } = createExploreCommands(ctx, service);
  const first = commands.search({ text: 'same' });
  const second = commands.search({ text: 'same' });
  requests[1].resolve([{ videoId: 'v1', start: 2, end: 3, text: 'Latest' }]);
  await second;
  requests[0].reject(new Error('stale failure'));
  await first;
  assert.equal(state.search.status, 'ready');
  assert.equal(state.search.results[0].text, 'Latest');
  const stale = commands.search({ text: 'same' });
  await commands.search({ text: '' });
  requests[2].resolve([{ videoId: 'v1', text: 'Stale' }]);
  await stale;
  assert.equal(state.search.status, 'idle');
});

test('thumbnail metadata accepts only safe HTTPS URLs', () => {
  const base = { id: 'v1', length: 1 };
  assert.equal(
    recording({ ...base, thumbnail: 'https://images.example/thumb.jpg' })
      .thumbnailUrl,
    'https://images.example/thumb.jpg',
  );
  for (const thumbnail of [
    'file:///tmp/private',
    'javascript:alert(1)',
    'https://user:secret@example.com/img',
  ])
    assert.equal(recording({ ...base, thumbnail }).thumbnailUrl, null);
});

test('accepted transcription with delayed text uses read retry and keeps its receipt flag', async () => {
  const { record, service, commands } = library();
  let requests = 0;
  service.requestTranscript = async () => {
    requests++;
  };
  service.transcript = async () => ({ text: '', status: 'empty', words: [] });
  await commands.commands.requestTranscript({ id: 'r1' });
  assert.equal(record.transcriptRequested, true);
  assert.equal(record.transcriptStatus, 'empty');
  await commands.open('r1');
  assert.equal(requests, 1);
});
