// A small still of the main display, shown by onboarding as proof that screen recording
// is allowed. It is returned to that window only and is never stored or sent anywhere.
const SIZE = { width: 296, height: 184 };

// allowed(): whether a preview may be taken at all (macOS permission, and not a test run).
// capturer: Electron's desktopCapturer.
function createScreenPreview({ capturer, allowed }) {
  let inFlight = null; // one capture at a time, however often a window asks

  async function capture() {
    if (!allowed()) return null;
    try {
      const [screen] = await capturer.getSources({
        types: ['screen'],
        thumbnailSize: SIZE,
      });
      const image = screen?.thumbnail;
      return image && !image.isEmpty() ? image.toDataURL() : null;
    } catch {
      return null; // the window falls back to a plain tick
    }
  }

  return {
    capture() {
      inFlight ||= capture().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

module.exports = { createScreenPreview };
