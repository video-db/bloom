// The one place that asks VideoDB's editor for a new video: the kept ranges of a recording
// joined in order, with subtitles made from what is said and a title over the first
// seconds. The result is a stream in VideoDB; the recording itself is never changed.
const { ServiceError, request } = require('./errors');
const { mediaUrl } = require('./library');

const RENDER_DEADLINE_MS = 15 * 60 * 1000;
const TITLE_SECONDS = 2.5;
const MAX_RANGES = 400; // more cuts than this is not a recording Bloom should be editing

function createEditing({ account, assertCurrent, editor }) {
  return {
    // ranges: [{ start, end }] of the original, in order. subtitles: boolean.
    // title: words for the title card, or '' for none. -> { streamUrl, playerUrl }
    async makeVersion({ videoId, ranges, subtitles, title }) {
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
      } = editor;
      const timeline = new EditorTimeline(scope.conn);
      const video = new Track();
      let at = 0;
      for (const range of ranges) {
        const duration = Number((range.end - range.start).toFixed(2));
        video.addClip(
          Number(at.toFixed(2)),
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
          0,
          new Clip({
            asset: new CaptionAsset({ src: 'auto' }),
            duration: total,
          }),
        );
        timeline.addTrack(captions);
      }
      if (title) {
        const card = new Track();
        card.addClip(
          0,
          new Clip({
            asset: new EditorTextAsset({
              text: title,
              font: new Font({ size: 44, color: '#FFFFFF' }),
              background: new Background({ color: '#17171C', opacity: 0.85 }),
            }),
            duration: Math.min(TITLE_SECONDS, total),
          }),
        );
        timeline.addTrack(card);
      }
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
