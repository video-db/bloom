// Versions of a recording on the recording page: which one is playing, the "Playing" row
// that lists them, and the plain-words account of where they are kept.
import { esc, clock } from '../shared/dom.js';

// A moment of the original as a moment of a version: the cuts before it are gone, and a
// moment inside a cut lands where the cut was. The same sum as the engine's make.js.
export function remap(at, cuts = []) {
  let gone = 0;
  for (const cut of cuts) {
    if (at <= cut.from) break;
    gone += Math.min(at, cut.to) - cut.from;
  }
  return Math.max(0, at - gone);
}

// The version being watched, or null for the original. Make always works on the original.
export const playingVersion = (r, page) =>
  (page.mode === 'watch' && r?.versions?.find((v) => v.id === page.playing)) ||
  null;

// What the player is given: the recording itself, or one of its versions.
export function playable(r, page) {
  const version = playingVersion(r, page);
  return version
    ? {
        id: `${r.id}:${version.id}`,
        streamUrl: version.streamUrl,
        duration: version.duration,
        cuts: version.cuts,
      }
    : r;
}

// The recording as the timeline should draw it while a version plays: the version's
// length and chapters, and the person's marks where they now fall.
export const timed = (r, version) =>
  version
    ? {
        duration: version.duration,
        summary: { chapters: version.chapters || [] },
        marks: (r.marks || []).map((m) => ({
          ...m,
          at: remap(m.at, version.cuts),
        })),
      }
    : r;

// Where versions live, said once and in full for whoever wants to know.
export const versionsNote = (lead) =>
  /* HTML */ `<details class="versions-note" data-keep="versions-note">
    <summary>${lead} <u>What this means</u></summary>
    <ul>
      <li>
        A version is a new video made from this recording. The original is never
        changed.
      </li>
      <li>
        The video is stored in VideoDB, so its link works from anywhere, not
        only on this Mac.
      </li>
      <li>
        The list of versions is kept by Bloom on this Mac. On another Mac, or if
        Bloom’s data is reset, this recording shows only the original.
      </li>
      <li>
        Removing a version takes it off this list. A link you already shared
        keeps working.
      </li>
    </ul>
  </details>`;

// What is playing: the original and each version, one click apart.
export function playingRow(r, page) {
  const current = playingVersion(r, page);
  const versions = r.versions || [];
  const chip = (id, name, seconds, on, fresh) =>
    /* HTML */ `<button
      class="version ${on ? 'on' : ''}"
      data-play="${esc(id)}"
      aria-pressed="${on}"
    >
      <b>${esc(name)}</b><span class="caption">${clock(seconds)}</span>${
        fresh ? '<span class="chip ok">Ready</span>' : ''
      }
    </button>`;
  return /* HTML */ `<div class="now-playing">
      <span class="label">Playing</span>
      ${chip('original', 'Original', r.duration, !current, false)}${versions
        .map((v) =>
          chip(
            v.id,
            v.name,
            v.duration,
            current?.id === v.id,
            r.making?.status === 'ready' && r.making.version === v.id,
          ),
        )
        .join('')}
      ${
        current
          ? /* HTML */ `<details class="record-menu version-menu">
              <summary
                aria-label="${esc(current.name)} actions"
                title="${esc(current.name)} actions"
              >
                •••
              </summary>
              <div>
                <button
                  data-ui="copy-link"
                  data-id="${esc(r.id)}"
                  data-version="${esc(current.id)}"
                >
                  Copy link
                </button>
                <button
                  class="destructive"
                  data-remove-version="${esc(current.id)}"
                  data-id="${esc(r.id)}"
                >
                  Remove from this Mac…
                </button>
              </div>
            </details>`
          : ''
      }
    </div>
    ${versions.length ? versionsNote('Versions are kept on this Mac.') : ''}`;
}
