// Recording a single window, on the real engine with a fake recorder: the controls that
// appear while a window is being recorded. Usage: node src/tests/window-ui.cjs [light|dark]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(
  process.env.BLOOM_PLAYWRIGHT_MODULE || 'playwright',
);
const root = path.resolve(__dirname, '../..');
const evidence =
  process.env.BLOOM_UI_EVIDENCE || path.join(root, '.context/window-ui');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  const theme = process.argv[2] || 'light';
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      path.join(root, 'src/main/index.js'),
      '--fixture',
      '--fresh',
      '--skip-onboarding',
      '--keep-open',
      `--${theme}`,
    ],
  });
  const errors = [];
  app.on('window', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  try {
    await app.evaluate(async () => {
      const engine = global.__bloom.getEngine();
      engine.command('signIn', { key: 'k' });
      await engine.whenIdle();
      engine.command('refreshWindows');
      await engine.whenIdle();
      engine.command('chooseWindow', { id: 'window:a' });
      global.__bloom.showPanel();
    });
    let panel;
    for (let i = 0; i < 100 && !panel; i++) {
      panel = app.windows().find((p) => p.url().includes('surface=panel'));
      if (!panel) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await panel.emulateMedia({ colorScheme: theme });
    const calls = () =>
      app.evaluate(() =>
        global.__bloom
          .getFixture()
          .calls.filter(([name]) =>
            ['switchWindow', 'setWindowEnabled'].includes(name),
          ),
      );
    await panel.getByRole('button', { name: /Start recording/ }).click();
    await panel.locator('.ph .timer').waitFor();
    // The window is named, and can be switched or hidden without stopping.
    assert.match(
      await panel.locator('.source-what').innerText(),
      /Window · Google Chrome · Billing – Northstar/,
    );
    await panel.getByRole('button', { name: /Switch window/ }).click();
    await panel.locator('[data-switch-window]').first().waitFor();
    assert.equal(await panel.locator('[data-switch-window]').count(), 2);
    await panel.screenshot({ path: path.join(evidence, `${theme}-switch.png`) });
    await panel.locator('[data-switch-window="window:c"]').click();
    await panel.getByText('Figma · Checkout flow').waitFor();
    assert.equal(await panel.locator('[data-switch-window]').count(), 0);
    await panel.getByRole('button', { name: 'Hide window', exact: true }).click();
    await panel.getByRole('button', { name: 'Show window', exact: true }).waitFor();
    await panel.getByText('The recording shows a plain card').waitFor();
    await panel.screenshot({ path: path.join(evidence, `${theme}-hidden.png`) });
    await panel.getByRole('button', { name: 'Show window', exact: true }).click();
    await panel.getByRole('button', { name: 'Hide window', exact: true }).waitFor();
    assert.deepEqual(await calls(), [
      ['switchWindow', 'window:c'],
      ['setWindowEnabled', false],
      ['setWindowEnabled', true],
    ]);
    // Pause keeps the same controls; Stop ends as any recording does.
    await panel.getByRole('button', { name: 'Pause', exact: true }).click();
    await panel.getByRole('button', { name: /Switch window/ }).waitFor();
    await panel.getByRole('button', { name: 'Resume', exact: true }).click();
    await panel.getByRole('button', { name: 'Stop recording', exact: true }).click();
    await panel.locator('.tray-card', { hasText: 'Processing' }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`Window ${theme} walkthrough passes: named, switched, hidden, shown, paused, stopped.`);
  } finally {
    await app
      .evaluate(() => global.__bloom.getEngine().dispose())
      .catch(() => {});
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
