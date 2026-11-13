// Command-line and environment flags, and the paths this entry reads and writes.
// Runs beside the shipping app without touching it: separate entry, separate user data.
const path = require('node:path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const UI = path.join(ROOT, 'ui');
const PRELOAD = path.join(ROOT, 'preload.js');

// On when passed as --name, or as BLOOM_NEXT_NAME=1 in the environment.
const flag = (name) =>
  process.argv.includes(`--${name}`) ||
  process.env[`BLOOM_NEXT_${name.toUpperCase().replace(/-/g, '_')}`] === '1';

// Lets either theme be reviewed on any machine.
const forcedTheme = () =>
  flag('light') ? 'light' : flag('dark') ? 'dark' : null;

// Must run before anything reads the user-data path.
function separateUserData() {
  app.setName('Bloom Next');
  app.setPath('userData', path.join(app.getPath('appData'), 'bloom-next'));
}

// null keeps preferences in memory only, so automation starts from defaults.
const prefsFile = () =>
  flag('fresh') ? null : path.join(app.getPath('userData'), 'prefs.json');

module.exports = {
  ASSETS,
  UI,
  PRELOAD,
  flag,
  forcedTheme,
  separateUserData,
  prefsFile,
};
