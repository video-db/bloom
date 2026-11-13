// Where Bloom's floating windows may sit so that they are not in the recording. macOS gives
// an app no way to keep a window out of another process's screen capture, and the recorder
// leaves nothing out of a display recording, so the only safe places are: anywhere while a
// single window is being recorded, or a display other than the one being recorded.
// (See "Keeping Bloom's own floating windows out of a display recording" in the gaps page.)

// displays: [{ id, workArea }] as Electron's screen module gives them. Returns the display
// to use, or null when there is nowhere the window would stay out of the recording.
function safeDisplay(state, displays, primary) {
  if (!displays.length) return null;
  if (state.sources.window) return primary || displays[0];
  const recorded = String(state.sources.screen || '').split(':')[1];
  // If the recorded display cannot be told apart from the others, nowhere is known safe.
  if (!recorded || !displays.some((d) => String(d.id) === recorded))
    return null;
  return displays.find((d) => String(d.id) !== recorded) || null;
}

// Top-left corner for a window of `size` on `display`: where it was last put if that is
// still on this display, otherwise the left edge at mid-height, where Loom keeps its own.
function placeOn(display, size, saved) {
  const area = display.workArea;
  const inside =
    saved &&
    saved.x >= area.x &&
    saved.y >= area.y &&
    saved.x + size.width <= area.x + area.width &&
    saved.y + size.height <= area.y + area.height;
  return inside
    ? { x: saved.x, y: saved.y }
    : {
        x: area.x + 16,
        y: Math.round(area.y + (area.height - size.height) / 2),
      };
}

module.exports = { safeDisplay, placeOn };
