// Versions of a recording: new videos made from it for a purpose. The video is made by
// VideoDB and stays there; the list of a recording's versions is kept with the recording
// on this Mac. The original is never changed.
const { randomUUID } = require('node:crypto');
const { plan, chaptersFor, CARD_SECONDS } = require('./make');

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
  // choices: silences, subtitles, title, chapters, end (each on or off). text: the title's
  // words; titleStyle: 'over' | 'card' | 'third'; endText: the end card's words.
  async function makeVersion({
    id,
    silences,
    subtitles,
    title,
    chapters,
    text,
    titleStyle = 'over',
    end = false,
    endText = '',
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
    // A title card with no words is not a title card.
    if (title && text !== undefined && !text.trim()) title = false;
    // The same goes for an end card.
    const closing = end ? endText.trim().slice(0, 80) : '';
    const lead = title && titleStyle === 'card' ? CARD_SECONDS : 0;
    if (!silences && !subtitles && !title && !closing)
      return fail('Choose at least one change to make.');
    ctx.update(id, { making: { status: 'working' } });
    let result;
    try {
      result = await service.makeVersion({
        videoId: record.videoId,
        ranges: made.ranges,
        subtitles: !!subtitles,
        title: title ? (text ?? record.title).trim().slice(0, 80) : '',
        titleStyle,
        endText: closing,
      });
    } catch (error) {
      // Said once, on the page it happened on. When VideoDB may have got the request,
      // "nothing was changed" would not be true of VideoDB, only of this recording.
      if (scope === ctx.scope())
        fail(
          error?.uncertain || error?.code === 'timeout'
            ? 'VideoDB did not answer in time, so Bloom has no video to show. This recording is unchanged; try again.'
            : 'The video could not be made. This recording is unchanged; try again.',
        );
      return;
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
      // Cards add their own seconds before and after the recording.
      duration: made.length + lead + (closing ? CARD_SECONDS : 0),
      lead,
      createdAt: Date.now(),
      cuts: made.cuts,
      subtitles: !!subtitles,
      titled: !!title,
      chapters: chapters ? chaptersFor(current, made.cuts, lead) : [],
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
          // A version still being made stays in hand; only a finished note is cleared.
          ...(record.making?.status === 'working' ? {} : { making: null }),
        });
      },
    },
  };
}

module.exports = { createMakeCommands };
