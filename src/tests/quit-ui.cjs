// Quitting never asks about a recording that is being processed (ADR 0004): with the real
// engine on a fake recorder, quit during processing must exit with no dialog.
// Usage: node src/tests/quit-ui.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { _electron } = require(
  process.env.BLOOM_PLAYWRIGHT_MODULE || 'playwright',
);
const root = path.resolve(__dirname, '../..');

(async () => {
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      path.join(root, 'src/main/index.js'),
      '--fixture',
      '--fresh',
      '--skip-onboarding',
    ],
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const phase = await app.evaluate(async ({ dialog }) => {
      global.__asked = 0;
      dialog.showMessageBoxSync = () => {
        global.__asked += 1;
        return 0; // "Keep Bloom Open": a question would block the quit
      };
      const engine = global.__bloom.getEngine();
      engine.command('signIn', { key: 'k' });
      await engine.whenIdle();
      engine.command('start');
      await engine.whenIdle();
      engine.command('stop');
      await engine.whenIdle();
      return engine.getState().phase;
    });
    assert.equal(phase, 'saving', 'a recording is being processed');
    const closed = new Promise((resolve) => app.on('close', resolve));
    app.evaluate(({ app: electron }) => electron.quit()).catch(() => {});
    const outcome = await Promise.race([
      closed.then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('open'), 10000)),
    ]);
    assert.equal(outcome, 'closed', 'Bloom quits while a recording is processed');
    console.log('Quit walkthrough passes: no question while processing.');
  } finally {
    try {
      app.process().kill('SIGKILL');
    } catch {
      // already gone
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
