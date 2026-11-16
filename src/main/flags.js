// Command-line and environment flags, and the paths this entry reads and writes.
const path = require('node:path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const UI = path.join(ROOT, 'ui');
const PRELOAD = path.join(ROOT, 'preload.js');

// Flags that exist for the tests. A packaged app ignores them, so nothing in someone's
// shell or launch arguments can make their Bloom start empty or skip setup.
const TEST_ONLY = ['fresh', 'fixture', 'skip-onboarding', 'keep-open'];

// On when passed as --name, or as BLOOM_NAME=1 in the environment.
const flag = (name) =>
  !(app.isPackaged && TEST_ONLY.includes(name)) &&
  (process.argv.includes(`--${name}`) ||
    process.env[`BLOOM_${name.toUpperCase().replace(/-/g, '_')}`] === '1');

// Lets either theme be reviewed on any machine.
const forcedTheme = () =>
  flag('light') ? 'light' : flag('dark') ? 'dark' : null;

// Must run before anything reads the user-data path.
// A run driven by the tests rather than by a person.
const automated = () => flag('fresh') || flag('fixture');

// The folder is not the system default on purpose: the app this one replaced kept its key and
// database there, and this app never opens them (no legacy-data migration).
function separateUserData() {
  app.setName('Bloom');
  // Automated runs get their own folder: they must not read or write a person's data, and
  // they must be able to start while that person's Bloom is open (one instance per folder).
  const folder = automated() ? 'bloom-next-test' : 'bloom-next';
  app.setPath('userData', path.join(app.getPath('appData'), folder));
}

// null keeps preferences in memory only, so automation starts from defaults.
const prefsFile = () =>
  flag('fresh') ? null : path.join(app.getPath('userData'), 'prefs.json');

module.exports = {
  ASSETS,
  UI,
  PRELOAD,
  flag,
  automated,
  forcedTheme,
  separateUserData,
  prefsFile,
};
