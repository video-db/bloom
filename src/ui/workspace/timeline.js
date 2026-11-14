// The timeline under the video: the recording's chapters as segments, the person's marks as
// diamonds, and the playhead. player.js moves the playhead and fills the segments as the
// video plays; clicking or dragging along it moves through the recording.
import { esc, clock } from '../shared/dom.js';

// The recording as parts: its chapters when the summary has them, otherwise one part.
export function parts(r) {
  const total = Math.max(r.duration || 0, 1);
  const chapters = (r.summary?.chapters || []).filter((c) => c.at < total);
  const list = chapters.length > 1 ? chapters : [{ title: '', at: 0 }];
  return list.map((chapter, index) => ({
    title: chapter.title,
    from: chapter.at,
    to: list[index + 1]?.at ?? total,
  }));
}

export function timeline(r) {
  const total = Math.max(r.duration || 0, 1);
  const list = parts(r);
  const span = (p) =>
    `style="flex:${p.to - p.from} 1 0" data-from="${p.from}" data-to="${p.to}"`;
  return /* HTML */ `<div
      class="tl"
      data-timeline
      role="slider"
      tabindex="0"
      aria-label="Position in the recording"
      aria-valuemin="0"
      aria-valuemax="${Math.round(total)}"
      aria-valuenow="0"
    >
      <div class="tl-track">
        ${list.map((p) => `<span class="tl-part" ${span(p)}></span>`).join('')}
      </div>
      ${(r.marks || [])
        .filter((m) => m.at <= total)
        .map((m) => {
          const label = `${clock(m.at)} · ${m.text || 'Marked moment'}`;
          return `<button class="tl-mark" style="left:${(m.at / total) * 100}%" data-seek="${m.at}" title="${esc(label)}" aria-label="Mark at ${esc(label)}"></button>`;
        })
        .join('')}
      <span class="tl-pin"></span>
    </div>
    ${
      list.length > 1
        ? /* HTML */ `<div class="tl-chapters" aria-label="Chapters">
            ${list
              .map(
                (p) =>
                  `<button class="tl-chapter" ${span(p)} data-seek="${p.from}" title="${esc(p.title)} · ${clock(p.from)}"><b>${esc(p.title)}</b> ${clock(p.from)}</button>`,
              )
              .join('')}
          </div>`
        : ''
    }`;
}
