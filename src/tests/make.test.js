// Making a version of a recording: what is cut, what is asked of VideoDB's editor, and what
// is kept with the recording afterwards.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quiet, plan, remap, chaptersFor } = require('../engine/videodb/make');
const { createEditing } = require('../engine/videodb/editing');
const { createFixture, flush } = require('./helpers/fixture');

const word = (start, end) => ({ word: 'w', start, end });

test('silences are the stretches of 0.8 s or more without a word, less a margin', () => {
  const words = [word(1, 1.5), word(1.6, 2), word(5, 5.4), word(5.9, 6.2)];
  assert.deepEqual(quiet(words, 10), [
    { from: 0, to: 0.85 }, // before the first word
    { from: 2.15, to: 4.85 }, // the pause
    { from: 6.35, to: 10 }, // after the last word
  ]);
  assert.deepEqual(
    quiet([word(0.2, 1), word(1.5, 2)], 2.3),
    [],
    'short gaps stay',
  );
  // A long word overlapping the ones after it, and words out of order: what counts is the
  // latest end heard so far.
  assert.deepEqual(
    quiet([word(2, 2.2), word(0, 3), word(2.5, 2.7), word(6, 6.5)], 6.5),
    [{ from: 3.15, to: 5.85 }],
  );
  assert.deepEqual(quiet([], 10), []);
  assert.deepEqual(quiet(undefined, 10), []);
});

test('the plan keeps everything between the cuts, in order', () => {
  const record = {
    duration: 10,
    quiet: [
      { from: 2.15, to: 4.85 },
      { from: 6.35, to: 12 }, // runs past the end of the recording
    ],
  };
  assert.deepEqual(plan(record, { silences: true }), {
    ranges: [
      { start: 0, end: 2.15 },
      { start: 4.85, end: 6.35 },
    ],
    cuts: [
      { from: 2.15, to: 4.85 },
      { from: 6.35, to: 10 },
    ],
    length: 3.65,
  });
  assert.deepEqual(plan(record, { silences: false }), {
    ranges: [{ start: 0, end: 10 }],
    cuts: [],
    length: 10,
  });
  assert.deepEqual(plan({ duration: 0 }).ranges, []);
});

test('a moment of the original is found again in the version', () => {
  const cuts = [
    { from: 2, to: 5 },
    { from: 8, to: 9 },
  ];
  assert.equal(remap(1, cuts), 1);
  assert.equal(remap(3, cuts), 2, 'inside a cut: where the cut was');
  assert.equal(remap(6, cuts), 3);
  assert.equal(remap(10, cuts), 6);
  assert.deepEqual(
    chaptersFor(
      {
        summary: {
          chapters: [
            { title: 'One', at: 0 },
            { title: 'Two', at: 6 },
          ],
        },
        marks: [{ at: 1, text: 'ignored when there are chapters' }],
      },
      cuts,
    ),
    [
      { title: 'One', at: 0 },
      { title: 'Two', at: 3 },
    ],
  );
  assert.deepEqual(
    chaptersFor(
      {
        marks: [
          { at: 6, text: '' },
          { at: 1, text: 'Start' },
        ],
      },
      cuts,
    ),
    [
      { title: 'Start', at: 1 },
      { title: 'Marked moment', at: 3 },
    ],
    'without chapters, the marks',
  );
});

test('the editor is asked for the kept ranges joined up, with subtitles and a title', async () => {
  const made = [];
  class Track {
    constructor() {
      this.clips = [];
    }
    addClip(start, clip) {
      this.clips.push([
        start,
        clip.asset.kind,
        clip.duration,
        clip.asset.config,
      ]);
    }
  }
  const asset = (kind) =>
    class {
      constructor(config) {
        this.kind = kind;
        this.config = config;
      }
    };
  const editor = {
    Track,
    Clip: class {
      constructor(config) {
        Object.assign(this, config);
      }
    },
    EditorVideoAsset: asset('video'),
    CaptionAsset: asset('caption'),
    EditorTextAsset: asset('text'),
    Font: asset('font'),
    Background: asset('background'),
    EditorTimeline: class {
      constructor(conn) {
        this.conn = conn;
        this.tracks = [];
      }
      addTrack(track) {
        this.tracks.push(track);
      }
      async generateStream() {
        made.push(this);
        this.playerUrl = 'https://player.example/v';
        return 'https://stream.example/v.m3u8';
      }
    },
  };
  const scope = { conn: { marker: true } };
  const editing = createEditing({
    account: () => scope,
    assertCurrent() {},
    editor,
  });
  const result = await editing.makeVersion({
    videoId: 'm-1',
    ranges: [
      { start: 0, end: 2.15 },
      { start: 4.85, end: 6.35 },
    ],
    subtitles: true,
    title: 'Billing walkthrough',
  });
  assert.deepEqual(result, {
    streamUrl: 'https://stream.example/v.m3u8',
    playerUrl: 'https://player.example/v',
  });
  const [video, captions, title] = made[0].tracks.map((t) => t.clips);
  assert.equal(made[0].conn, scope.conn);
  assert.deepEqual(
    video.map(([start, kind, duration, config]) => [
      start,
      kind,
      duration,
      config,
    ]),
    [
      [0, 'video', 2.15, { id: 'm-1', start: 0 }],
      [2.15, 'video', 1.5, { id: 'm-1', start: 4.85 }],
    ],
  );
  assert.deepEqual(
    captions.map((c) => c.slice(0, 3)),
    [[0, 'caption', 3.65]],
  );
  assert.deepEqual(
    title.map((c) => c.slice(0, 3)),
    [[0, 'text', 2.5]],
  );
  assert.equal(title[0][3].text, 'Billing walkthrough');

  // Plain: no subtitles, no title. And nothing is asked for an empty or unreadable plan.
  await editing.makeVersion({
    videoId: 'm-1',
    ranges: [{ start: 0, end: 5 }],
    subtitles: false,
    title: '',
  });
  assert.equal(made[1].tracks.length, 1);
  await assert.rejects(
    editing.makeVersion({
      videoId: 'm-1',
      ranges: [],
      subtitles: true,
      title: '',
    }),
    { code: 'invalid-input' },
  );
  await assert.rejects(
    editing.makeVersion({
      videoId: 'm-1',
      ranges: [{ start: 3, end: 1 }],
      subtitles: true,
      title: '',
    }),
    { code: 'invalid-input' },
  );
  assert.equal(made.length, 2);
  // A stream that is not a link is not a version.
  editor.EditorTimeline.prototype.generateStream = async () => 'not a link';
  await assert.rejects(
    editing.makeVersion({
      videoId: 'm-1',
      ranges: [{ start: 0, end: 5 }],
      subtitles: false,
      title: '',
    }),
    { code: 'invalid-response' },
  );
});

async function recorded(t) {
  const f = createFixture();
  t.after(() => f.engine.dispose());
  await f.command('signIn', { key: 'synthetic-key' });
  await f.command('start');
  f.advance(10000);
  await f.command('stop');
  f.recorder.finish();
  await flush();
  await f.engine.whenIdle();
  await flush();
  const record = () => f.engine.getState().recordings[0];
  await f.command('openRecording', { id: record().id });
  return { ...f, record };
}
const all = { silences: true, subtitles: true, title: true, chapters: true };

test('a version is made from the recording and kept with it; the original is untouched', async (t) => {
  const f = await recorded(t);
  const before = f.record();
  assert.ok(
    before.quiet.length,
    'the silences are known once the transcript is',
  );
  await f.command('makeVersion', { id: before.id, ...all, text: 'My title' });
  const asked = f.calls.find(([name]) => name === 'makeVersion')[1];
  assert.equal(asked.videoId, before.videoId);
  assert.equal(asked.subtitles, true);
  assert.equal(asked.title, 'My title');
  assert.ok(asked.ranges.length > 1, 'the silence is cut out');
  const after = f.record();
  assert.equal(after.versions.length, 1);
  const [version] = after.versions;
  assert.equal(version.name, 'Walkthrough');
  assert.match(version.streamUrl, /^https:\/\/stream\.example\/version-/);
  assert.ok(version.duration < before.duration);
  assert.deepEqual(after.making, { status: 'ready', version: version.id });
  assert.ok(version.chapters.length > 1);
  assert.equal(after.streamUrl, before.streamUrl);
  assert.equal(after.duration, before.duration);

  // A second one gets its own name; removing one leaves the other.
  await f.command('makeVersion', {
    id: before.id,
    silences: false,
    subtitles: true,
    title: false,
    chapters: false,
  });
  const second = f.record().versions[1];
  assert.equal(second.name, 'Walkthrough 2');
  assert.equal(second.duration, before.duration, 'nothing cut');
  assert.equal(f.calls.filter(([n]) => n === 'makeVersion')[1][1].title, '');
  assert.deepEqual(second.chapters, []);
  await f.command('removeVersion', { id: before.id, version: version.id });
  assert.deepEqual(
    f.record().versions.map((v) => v.name),
    ['Walkthrough 2'],
  );
});

test('a version that cannot be made says so and leaves nothing behind', async (t) => {
  const f = await recorded(t);
  const id = f.record().id;
  f.service.failNextVersion = true;
  await f.command('makeVersion', { id, ...all });
  assert.equal(f.record().making.status, 'error');
  assert.equal((f.record().versions || []).length, 0);
  assert.match(f.record().making.message, /This recording is unchanged/);
  assert.equal(f.engine.getState().problem, null, 'said once, on the page');
  // Nothing chosen is not a version, and nothing is asked of VideoDB for it.
  const asked = f.calls.filter(([n]) => n === 'makeVersion').length;
  await f.command('makeVersion', {
    id,
    silences: false,
    subtitles: false,
    title: false,
    chapters: true,
  });
  assert.equal(f.record().making.status, 'error');
  assert.equal(f.calls.filter(([n]) => n === 'makeVersion').length, asked);
  // Unreadable choices are refused before they reach the engine's work.
  await f.command('makeVersion', { id, silences: 'yes' });
  assert.equal(f.calls.filter(([n]) => n === 'makeVersion').length, asked);
});

test('versions are kept with the recording across a restart', async (t) => {
  const { createRecordingCache } = require('../engine/videodb/cache');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-versions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'library.json');
  const scope = 'a'.repeat(64);
  createRecordingCache(file).save(scope, [
    {
      id: 'r',
      title: 'Demo',
      marks: [],
      quiet: [{ from: 1, to: 2 }],
      versions: [
        {
          id: 'v-1',
          name: 'Walkthrough',
          duration: 9,
          streamUrl: 'https://stream.example/v.m3u8',
        },
      ],
      making: { status: 'working' },
    },
  ]);
  const [kept] = createRecordingCache(file).load(scope);
  assert.equal(kept.versions.length, 1);
  assert.equal(kept.versions[0].name, 'Walkthrough');
  assert.equal(kept.versions[0].streamUrl, 'https://stream.example/v.m3u8');
  assert.deepEqual(kept.quiet, [{ from: 1, to: 2 }]);
  assert.equal(
    kept.making,
    undefined,
    'work under way is not something to restore',
  );
});

test('removing a version while another is being made does not let a second one start', async (t) => {
  const { deferred } = require('./helpers/fixture');
  const f = await recorded(t);
  const id = f.record().id;
  await f.command('makeVersion', { id, ...all });
  const first = f.record().versions[0];
  const gate = deferred();
  const render = f.service.makeVersion;
  f.service.makeVersion = async (args) => {
    await gate.promise;
    return render(args);
  };
  // Straight to the engine: the fixture's command waits for everything under way.
  f.engine.command('makeVersion', { id, ...all });
  await flush();
  assert.equal(f.record().making.status, 'working');
  f.engine.command('removeVersion', { id, version: first.id });
  await flush();
  assert.equal(f.record().making.status, 'working', 'still in hand');
  const before = f.calls.filter(([n]) => n === 'makeVersion').length;
  f.engine.command('makeVersion', { id, ...all });
  await flush();
  assert.equal(f.calls.filter(([n]) => n === 'makeVersion').length, before);
  gate.resolve();
  await f.engine.whenIdle();
  assert.deepEqual(
    f.record().versions.map((v) => v.name),
    ['Walkthrough'],
  );
});

test('what is read back from disk is checked before it reaches the window', () => {
  const { storedVersions, spans } = require('../engine/videodb/make');
  assert.deepEqual(spans([{ from: 1, to: 2 }, { from: 3, to: 3 }, 'x', null]), [
    { from: 1, to: 2 },
  ]);
  assert.deepEqual(spans('nonsense'), []);
  const good = {
    id: 'v-1',
    name: 'Walkthrough',
    streamUrl: 'https://stream.example/v.m3u8',
    playerUrl: 'javascript:alert(1)',
    duration: 9,
    cuts: 'not a list',
    chapters: [{ title: 'One', at: 0 }, { title: 4 }],
  };
  assert.deepEqual(
    storedVersions([
      good,
      { ...good, id: 'v-2', streamUrl: 'http://insecure.example/v.m3u8' },
      { ...good, id: 'v-3', duration: 'long' },
      null,
    ]),
    [
      {
        id: 'v-1',
        recipe: 'walkthrough',
        name: 'Walkthrough',
        streamUrl: 'https://stream.example/v.m3u8',
        playerUrl: null,
        duration: 9,
        createdAt: 0,
        cuts: [],
        subtitles: false,
        titled: false,
        chapters: [{ title: 'One', at: 0 }],
      },
    ],
  );
  assert.deepEqual(storedVersions({ not: 'a list' }), []);
});
