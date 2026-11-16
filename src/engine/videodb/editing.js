// The one place that asks VideoDB's editor for a new video: the kept ranges of a recording
// joined in order, with subtitles made from what is said, a title in one of three styles
// and an end card. The result is a stream in VideoDB; the recording itself is never
// changed. Tracks added later are drawn above earlier ones: video, subtitles, titles.
const { ServiceError, request } = require('./errors');
const { mediaUrl } = require('./library');

const RENDER_DEADLINE_MS = 15 * 60 * 1000;
const { CARD_SECONDS } = require('./make');

const TITLE_SECONDS = 2.5; // a title over the first seconds of the recording
const THIRD_SECONDS = 4; // a small label in the corner
const INK = '#17171C'; // what a card's words sit on
const MAX_RANGES = 400; // more cuts than this is not a recording Bloom should be editing

function createEditing({ account, assertCurrent, editor }) {
  return {
    // ranges: [{ start, end }] of the original, in order. subtitles: boolean.
    // title: the title's words, or '' for none. titleStyle: 'over' the first seconds,
    // an opening 'card' before the recording, or a lower 'third' in the corner.
    // endText: words for a card after the recording, or ''. -> { streamUrl, playerUrl }
    async makeVersion({
      videoId,
      ranges,
      subtitles,
      title,
      titleStyle = 'over',
      endText = '',
    }) {
      if (!editor?.EditorTimeline)
        throw new ServiceError(
          'unavailable',
          'Making a video is not available in this build.',
        );
      if (
        typeof videoId !== 'string' ||
        !Array.isArray(ranges) ||
        !ranges.length ||
        ranges.length > MAX_RANGES ||
        !ranges.every(
          (r) =>
            Number.isFinite(r?.start) &&
            Number.isFinite(r?.end) &&
            r.start >= 0 &&
            r.end > r.start,
        )
      )
        throw new ServiceError(
          'invalid-input',
          'There is nothing to make a video from.',
        );
      const scope = account();
      const {
        EditorTimeline,
        Track,
        Clip,
        EditorVideoAsset,
        CaptionAsset,
        EditorTextAsset,
        Font,
        Background,
        Position,
        Offset,
      } = editor;
      const timeline = new EditorTimeline(scope.conn);
      // An opening card comes before the recording, so everything else starts after it.
      const lead = title && titleStyle === 'card' ? CARD_SECONDS : 0;
      if (lead || endText) timeline.background = INK;
      const video = new Track();
      let at = 0;
      for (const range of ranges) {
        // Never longer than the source: a length is cut to the hundredth, not rounded.
        const duration =
          Math.floor((range.end - range.start) * 100 + 1e-6) / 100;
        if (duration <= 0) continue;
        video.addClip(
          Number((lead + at).toFixed(2)),
          new Clip({
            asset: new EditorVideoAsset({ id: videoId, start: range.start }),
            duration,
          }),
        );
        at += duration;
      }
      timeline.addTrack(video);
      const total = Number(at.toFixed(2));
      if (subtitles) {
        const captions = new Track();
        captions.addClip(
          lead,
          new Clip({
            asset: new CaptionAsset({ src: 'auto' }),
            duration: total,
          }),
        );
        timeline.addTrack(captions);
      }
      const words = (text, size, boxed) =>
        new EditorTextAsset({
          text,
          font: new Font({ size, color: '#FFFFFF' }),
          ...(boxed
            ? { background: new Background({ color: INK, opacity: 0.85 }) }
            : {}),
        });
      const titles = new Track();
      if (title && titleStyle === 'card')
        titles.addClip(
          0,
          new Clip({ asset: words(title, 44, false), duration: CARD_SECONDS }),
        );
      else if (title && titleStyle === 'third')
        titles.addClip(
          0,
          new Clip({
            asset: words(title, 28, true),
            duration: Math.min(THIRD_SECONDS, total),
            // Anchored bottom-left, then moved in from the corner by a part of the frame.
            position: Position.bottomLeft,
            offset: new Offset({ x: 0.04, y: -0.12 }),
          }),
        );
      else if (title)
        titles.addClip(
          0,
          new Clip({
            asset: words(title, 44, true),
            duration: Math.min(TITLE_SECONDS, total),
          }),
        );
      if (endText)
        titles.addClip(
          Number((lead + total).toFixed(2)),
          new Clip({
            asset: words(endText, 44, false),
            duration: CARD_SECONDS,
          }),
        );
      if (titles.clips.length) timeline.addTrack(titles);
      // Asked once: a render that may have been accepted is never sent a second time.
      const stream = await request(() => timeline.generateStream(), {
        timeoutMs: RENDER_DEADLINE_MS,
        mutation: true,
      });
      assertCurrent(scope);
      const streamUrl = mediaUrl(stream || timeline.streamUrl);
      if (!streamUrl)
        throw new ServiceError(
          'invalid-response',
          'VideoDB did not return the new video. Try again.',
        );
      return { streamUrl, playerUrl: mediaUrl(timeline.playerUrl) };
    },
  };
}

module.exports = { createEditing };
