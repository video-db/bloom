const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createUnderstandCommands,
} = require('../engine/videodb/understand-commands');
const { createUnderstand } = require('../engine/videodb/understand');

function setup(title = 'Recording · Today') {
  let record = {
    id: 'r',
    videoId: 'v',
    title,
    transcript: 'We reviewed the onboarding flow.',
  };
  let result = { id: 'r', title };
  const calls = [];
  const ctx = {
    scope: () => 'account',
    find: () => record,
    update: (_, patch) => {
      record = { ...record, ...patch };
    },
    get: () => ({ result }),
    set: (patch) => {
      result = patch.result;
    },
  };
  const service = {
    summarise: async () => ({
      title: 'Onboarding flow review',
      text: 'Review summary.',
      keyPoints: [],
      actionItems: [],
    }),
    rename: async (id, name) => {
      calls.push([id, name]);
      return { title: name };
    },
  };
  return {
    ctx,
    service,
    calls,
    commands: createUnderstandCommands(ctx, service),
  };
}

test('a content title is saved remotely and updates the tray, but regeneration keeps it', async () => {
  const { ctx, calls, commands } = setup();
  await commands.ensure('r');
  assert.deepEqual(calls, [['v', 'Onboarding flow review']]);
  assert.equal(ctx.find().titleOrigin, 'content');
  assert.equal(ctx.get().result.title, 'Onboarding flow review');
  await commands.commands.summarise({ id: 'r' });
  assert.equal(calls.length, 1);
});

test('custom names and names changed during generation are preserved', async () => {
  const custom = setup('My chosen title');
  await custom.commands.ensure('r');
  assert.equal(custom.calls.length, 0);
  const f = setup();
  f.service.summarise = async () => {
    f.ctx.update('r', { titleOrigin: 'user', title: 'My name' });
    return { title: 'Generated name', text: 'Summary' };
  };
  await f.commands.ensure('r');
  assert.equal(f.calls.length, 0);
  assert.equal(f.ctx.find().title, 'My name');
});

test('failed title save preserves summary and records uncertainty', async () => {
  const f = setup();
  f.service.rename = async () => {
    throw Object.assign(new Error('timeout'), { uncertain: true });
  };
  await assert.rejects(f.commands.ensure('r'));
  assert.equal(f.ctx.find().summaryStatus, 'ready');
  assert.equal(f.ctx.find().pendingOperation, 'rename');
  assert.equal(f.ctx.find().title, 'Recording · Today');
});

test('title is part of the summary request and is bounded and single-line', async () => {
  let requests = 0;
  const service = createUnderstand({
    account: () => ({
      collection: {
        generateText: async (prompt) => {
          requests++;
          assert.match(prompt, /"title"/);
          return {
            output: { title: 'Topic\n' + 'x'.repeat(100), summary: 'Summary' },
          };
        },
      },
    }),
    read: (_, work) => work(),
  });
  const result = await service.summarise([{ at: 0, text: 'Transcript' }]);
  assert.equal(requests, 1);
  assert.equal(result.title.length, 80);
  assert(!result.title.includes('\n'));
});

test('chapters come with the summary: in order, from the start, inside the recording', async () => {
  const answer = (chapters) =>
    createUnderstand({
      account: () => ({
        collection: {
          generateText: async (prompt) => {
            assert.match(prompt, /"chapters"/);
            return { output: { summary: 'Summary', chapters } };
          },
        },
      }),
      read: (_, work) => work(),
    }).summarise([
      { at: 0, text: 'Plans' },
      { at: 98, text: 'Seats' },
      { at: 185, text: 'Invoices' },
    ]);
  assert.deepEqual(
    (
      await answer([
        { title: 'Invoices', at: 185 },
        { title: 'Plans\nand prices', at: 4.4 },
        { title: 'Seats', at: 98 },
        { title: 'Seats again', at: 98 },
        { title: 'After the end', at: 900 },
        { title: '', at: 120 },
        { title: 'No time' },
      ])
    ).chapters,
    [
      { title: 'Plans and prices', at: 0 },
      { title: 'Seats', at: 98 },
      { title: 'Invoices', at: 185 },
    ],
  );
  // One part is not chapters, and neither is an answer without the field.
  assert.deepEqual((await answer([{ title: 'All of it', at: 0 }])).chapters, []);
  assert.deepEqual((await answer(undefined)).chapters, []);
});

test('a user rename waits for an in-flight automatic rename and wins', async () => {
  const { createLibraryCommands } = require('../engine/videodb/library-commands');
  const f = setup();
  let finish;
  f.service.rename = (id, title) => {
    f.calls.push([id, title]);
    return f.calls.length === 1 ? new Promise((resolve) => { finish = () => resolve({ title }); }) : Promise.resolve({ title });
  };
  const generated = f.commands.ensure('r');
  await new Promise((resolve) => setImmediate(resolve));
  const library = createLibraryCommands(f.ctx, f.service, { beforeRename: f.commands.whenNamed });
  const manual = library.commands.renameRecording({ id: 'r', text: 'My final name' });
  assert.equal(f.calls.length, 1);
  finish();
  await Promise.all([generated, manual]);
  assert.equal(f.ctx.find().title, 'My final name');
  assert.equal(f.ctx.find().titleOrigin, 'user');
  assert.equal(f.ctx.get().result.title, 'My final name');
  assert.equal(f.calls.at(-1)[1], 'My final name');
});
