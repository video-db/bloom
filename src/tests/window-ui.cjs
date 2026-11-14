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
    // The camera: a round picture that floats on screen, in three sizes.
    await panel.getByRole('button', { name: 'Camera: Off' }).click();
    await panel.getByRole('button', { name: 'Camera: On' }).waitFor();
    let cam;
    for (let i = 0; i < 100 && !cam; i++) {
      cam = app.windows().find((p) => p.url().includes('surface=camera'));
      if (!cam) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await cam.locator('.cam-note').waitFor();
    assert.equal(
      await app.evaluate(() => global.__bloom.floatingCameraShowing()),
      true,
    );
    assert.match(
      await panel.locator('.source-group').innerText(),
      /The camera is not part of a window recording\./,
    );
    const camSize = () =>
      cam.evaluate(() => [window.innerWidth, window.innerHeight]);
    assert.deepEqual(await camSize(), [200, 200]);
    await cam.getByRole('button', { name: 'Large' }).dispatchEvent('click');
    for (let i = 0; i < 40 && (await camSize())[0] !== 280; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(await camSize(), [280, 280]);
    await cam.locator('.cam-sizes button.on[data-size="l"]').waitFor({
      state: 'attached',
    });
    // Dragged to a fraction left of the screen's edge: Electron refuses that position as
    // it stands (it rounds to negative zero), which used to stop the app with an error.
    const camAt = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('surface=camera'))
          .getPosition(),
      );
    const [fromX] = await camAt();
    await cam.evaluate(
      (dx) => window.bloom.ui('camera-drag', { dx, dy: 0 }),
      -fromX - 0.3,
    );
    await cam.evaluate(() => window.bloom.ui('camera-drop'));
    for (let i = 0; i < 40 && (await camAt())[0] !== 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await camAt())[0], 0);
    await cam.screenshot({
      path: path.join(evidence, `camera-${theme}.png`),
      omitBackground: true,
    });
    await panel.getByRole('button', { name: /Start recording/ }).click();
    await panel.locator('.ph .timer').waitFor();
    // The camera can be turned off in the middle of a recording.
    await panel.getByRole('button', { name: 'Camera: On' }).click();
    await panel.getByRole('button', { name: 'Camera: Off' }).waitFor();
    assert.equal(
      await app.evaluate(() => global.__bloom.floatingCameraShowing()),
      false,
    );
    // The window is named, and can be switched or hidden without stopping.
    assert.match(
      await panel.locator('.source-what').innerText(),
      /Window · Google Chrome · Billing – Northstar/,
    );
    await panel.getByRole('button', { name: /Switch window/ }).click();
    await panel.locator('[data-switch-window]').first().waitFor();
    assert.equal(await panel.locator('[data-switch-window]').count(), 2);
    await panel.screenshot({
      path: path.join(evidence, `${theme}-switch.png`),
    });
    await panel.locator('[data-switch-window="window:c"]').click();
    await panel.getByText('Figma · Checkout flow').waitFor();
    assert.equal(await panel.locator('[data-switch-window]').count(), 0);
    await panel
      .getByRole('button', { name: 'Hide window', exact: true })
      .click();
    await panel
      .getByRole('button', { name: 'Show window', exact: true })
      .waitFor();
    await panel.getByText('The recording shows a plain card').waitFor();
    await panel.screenshot({
      path: path.join(evidence, `${theme}-hidden.png`),
    });
    await panel
      .getByRole('button', { name: 'Show window', exact: true })
      .click();
    await panel
      .getByRole('button', { name: 'Hide window', exact: true })
      .waitFor();
    assert.deepEqual(await calls(), [
      ['switchWindow', 'window:c'],
      ['setWindowEnabled', false],
      ['setWindowEnabled', true],
    ]);
    // The floating control is up while a window is recorded: it can never be in the picture.
    assert.equal(
      await app.evaluate(() => global.__bloom.floatingControlShowing()),
      true,
    );
    let float;
    for (let i = 0; i < 100 && !float; i++) {
      float = app.windows().find((p) => p.url().includes('surface=control'));
      if (!float) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await float.emulateMedia({ colorScheme: theme });
    await float.getByRole('button', { name: 'Stop recording' }).waitFor();
    assert.deepEqual(
      await float
        .locator('.fb')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
      [
        'Stop recording',
        'Pause',
        'Mark this moment',
        'Mute microphone',
        'Hide window',
      ],
    );
    await float.getByRole('button', { name: 'Mute microphone' }).click();
    await float.getByRole('button', { name: 'Unmute microphone' }).waitFor();
    assert.equal(
      await app.evaluate(() => global.__bloom.getEngine().getState().muted.mic),
      true,
    );
    await float.screenshot({
      path: path.join(evidence, `${theme}-control.png`),
      omitBackground: true,
    });
    await float.getByRole('button', { name: 'Pause', exact: true }).click();
    await float.getByRole('button', { name: 'Resume', exact: true }).waitFor();
    await float.getByRole('button', { name: 'Resume', exact: true }).click();
    await float.getByRole('button', { name: 'Unmute microphone' }).click();
    // Recording a display with only that display to sit on, it stays away (no fake display here
    // matches the recorded one, so nowhere is known to be safe).
    // Pause keeps the same controls; Stop ends as any recording does.
    await panel.getByRole('button', { name: 'Pause', exact: true }).click();
    await panel.getByRole('button', { name: /Switch window/ }).waitFor();
    await panel.getByRole('button', { name: 'Resume', exact: true }).click();
    await panel
      .getByRole('button', { name: 'Stop recording', exact: true })
      .click();
    await panel.locator('.tray-card', { hasText: 'Processing' }).waitFor();
    assert.equal(
      await app.evaluate(() => global.__bloom.floatingControlShowing()),
      false,
      'the control goes when the recording stops',
    );
    assert.deepEqual(errors, []);
    console.log(
      `Window ${theme} walkthrough passes: camera sized and dragged, named, switched, hidden, shown, floating control, paused, stopped.`,
    );
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
