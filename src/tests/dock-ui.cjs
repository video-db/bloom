// Native macOS Dock regression. Runs isolated windows without accounts or capture.
// Usage: BLOOM_PLAYWRIGHT_MODULE=/path/to/playwright node src/tests/dock-ui.cjs
const path = require('node:path');

if (process.versions.electron) {
  const { app } = require('electron');
  const { createWindows } = require('../main/windows');
  app.setPath('userData', process.env.BLOOM_DOCK_TEST_DIR);
  app.setActivationPolicy('regular');
  app.on('window-all-closed', () => {});
  app.whenReady().then(() => {
    global.__dockBeforePanel = app.dock.isVisible();
    global.__dockWindows = createWindows({
      ui: process.env.BLOOM_DOCK_TEST_DIR,
      preload: path.resolve(__dirname, '../preload.js'),
      keepOpen: true,
      background: true,
      theme: { paper: () => '#ffffff' },
      engine: {
        getState: () => ({ sample: true, phase: 'idle' }),
        command() {},
      },
      prefs: { all: () => ({ onboardingComplete: true }) },
      tray: { getBounds: () => ({ x: 40, y: 0, width: 22, height: 22 }) },
      isQuitting: () => true,
    });
    global.__dockWindows.createPanel();
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const { _electron } = require(
    process.env.BLOOM_PLAYWRIGHT_MODULE || 'playwright',
  );
  (async () => {
    if (process.platform !== 'darwin')
      return console.log('Dock check requires macOS.');
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bloom-dock-test-'),
    );
    fs.writeFileSync(
      path.join(directory, 'app.html'),
      '<!doctype html><title>Bloom Dock test</title>',
    );
    let app;
    try {
      app = await _electron.launch({
        executablePath: require('electron'),
        args: [__filename],
        env: { ...process.env, BLOOM_DOCK_TEST_DIR: directory },
      });
      await app.firstWindow();
      assert.equal(await app.evaluate(() => global.__dockBeforePanel), true);
      const visible = () => app.evaluate(({ app }) => app.dock.isVisible());
      assert.equal(
        await visible(),
        true,
        'creating the fullscreen-capable panel must retain the Dock',
      );
      await app.evaluate(() => global.__dockWindows.showPanel());
      assert.equal(
        await visible(),
        true,
        'showing the tray must retain the Dock',
      );
      await app.evaluate(() => global.__dockWindows.hidePanel());
      assert.equal(
        await visible(),
        true,
        'hiding the tray must retain the Dock',
      );
      await app.evaluate(() => global.__dockWindows.openMain('home'));
      assert.equal(
        await visible(),
        true,
        'opening the workspace must retain the Dock',
      );
      await app.evaluate(() => global.__dockWindows.openOnboarding());
      assert.equal(await visible(), true, 'opening setup must retain the Dock');
      await app.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      });
      assert.equal(
        await visible(),
        true,
        'closing windows must retain the Dock',
      );
      // Existing background walkthroughs must remain out of the Dock.
      await app.evaluate(({ app }) => {
        app.setActivationPolicy('accessory');
        global.__dockWindows.createPanel();
      });
      assert.equal(
        await visible(),
        false,
        'creating a panel must preserve accessory mode too',
      );
      console.log(
        'Native Dock visibility passes for panel creation/show/hide, workspace/setup and closed windows; accessory mode preserved.',
      );
    } finally {
      if (app) await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
