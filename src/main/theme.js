// Appearance: which theme the app follows, and the backdrop colour a window opens with.
const { nativeTheme } = require('electron');

// Matches --paper in ui/tokens.css so a window never flashes the wrong colour before its page paints.
const paper = () => (nativeTheme.shouldUseDarkColors ? '#17171a' : '#ffffff');

// forced: 'light' | 'dark' to pin a theme for review, or null to follow the preference.
function createTheme({ forced }) {
  let forcedTheme = forced;
  if (forcedTheme) nativeTheme.themeSource = forcedTheme;

  return {
    paper,
    // The appearance preference applies only while no theme is forced.
    follow(appearance) {
      if (!forcedTheme) nativeTheme.themeSource = appearance;
    },
    // Choosing an appearance in Settings overrides the review flag for the rest of the run.
    releaseForced() {
      forcedTheme = null;
    },
    onChange(listener) {
      nativeTheme.on('updated', listener);
    },
  };
}

module.exports = { createTheme };
