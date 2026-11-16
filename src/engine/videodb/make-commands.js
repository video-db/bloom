// Versions of a recording: new videos made from it for a purpose. The video is made by
// VideoDB and stays there; the list of a recording's versions is kept with the recording
// on this Mac. The original is never changed.
const { randomUUID } = require('node:crypto');
const { plan, chaptersFor } = require('./make');

const RECIPES = { walkthrough: 'Walkthrough' };
const MAX_VERSIONS = 20;

function createMakeCommands(ctx, service) {
  const nameFor = (record, recipe) => {
    const base = RECIPES[recipe];
    const taken = new Set((record.versions || []).map((v) => v.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++)
      if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  };
  // choices: silences, subtitles, title, chapters (each on or off); text: the title card.
  async function makeVersion({
    id,
    silences,
    subtitles,
    title,
    chapters,
    text,
  }) {
    const scope = ctx.scope();
    const record = ctx.find(id);
    if (
      !record?.videoId ||
      record.readOnly ||
      record.status !== 'ready' ||
      record.making?.status === 'working'
    )
      return;
    const fail = (message) =>
      ctx.update(id, { making: { status: 'error', message } });
    if ((record.versions || []).length >= MAX_VERSIONS)
      return fail(
        'This recording has as many versions as Bloom keeps. Remove one first.',
      );
    // Silences and subtitles both come from what was said.
    if ((silences || subtitles) && !record.transcript)
      return fail(
        'Add a transcript first: silences and subtitles come from it.',
      );
    const made = plan(record, { silences });
    if (!made.ranges.length)
      return fail('Nothing would be left of this recording.');
    if (!silences && !subtitles && !title)
      return fail('Choose at least one change to make.');
    ctx.update(id, { making: { status: 'working' } });
    let result;
    try {
      result = await service.makeVersion({
        videoId: record.videoId,
        ranges: made.ranges,
        subtitles: !!subtitles,
        title: title ? (text || record.title).trim().slice(0, 80) : '',
      });
    } catch (error) {
      if (scope === ctx.scope())
        fail('The video could not be made. Nothing was changed; try again.');
      throw error;
    }
    if (scope !== ctx.scope()) return;
    const current = ctx.find(id);
    if (!current) return;
    const version = {
      id: `v-${randomUUID()}`,
      recipe: 'walkthrough',
      name: nameFor(current, 'walkthrough'),
      streamUrl: result.streamUrl,
      playerUrl: result.playerUrl,
      duration: made.length,
      createdAt: Date.now(),
      cuts: made.cuts,
      subtitles: !!subtitles,
      titled: !!title,
      chapters: chapters ? chaptersFor(current, made.cuts) : [],
    };
    ctx.update(id, {
      versions: [...(current.versions || []), version],
      making: { status: 'ready', version: version.id },
    });
  }
  return {
    commands: {
      makeVersion,
      // Takes a version off this recording's list on this Mac. Its video stays in VideoDB,
      // so a link already shared keeps working.
      removeVersion({ id, version }) {
        const record = ctx.find(id);
        if (!record?.versions?.some((v) => v.id === version)) return;
        ctx.update(id, {
          versions: record.versions.filter((v) => v.id !== version),
          making: null,
        });
      },
    },
  };
}

module.exports = { createMakeCommands };
