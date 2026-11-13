const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(
  process.env.BLOOM_PLAYWRIGHT_MODULE || 'playwright',
);
const root = path.resolve(__dirname, '../..');
const evidence = path.join(root, '.context/connected-ui');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  const theme = process.argv[2] || 'light';
  // A hung window must fail the run, not stall it.
  setTimeout(() => {
    console.error('Connected walkthrough timed out.');
    process.exit(2);
  }, 150000).unref();
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      path.join(root, 'src/main/index.js'),
      '--connected-fixture',
      '--fresh',
      '--keep-open',
      `--${theme}`,
    ],
  });
  const errors = [];
  app.on('window', (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.route('https://**/*', (route) => route.abort());
  });
  async function windowFor(surface) {
    for (let i = 0; i < 100; i++) {
      const page = app
        .windows()
        .find((p) => p.url().includes(`surface=${surface}`));
      if (page) {
        await page.emulateMedia({ colorScheme: theme });
        return page;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Missing ${surface} window`);
  }
  async function phase(value) {
    for (let i = 0; i < 100; i++) {
      if (
        (await app.evaluate(
          () => global.__bloom.getEngine().getState().phase,
        )) === value
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Expected phase ${value}`);
  }
  try {
    const onboarding = await windowFor('onboarding');
    const signedOutPanel = await windowFor('panel');
    await signedOutPanel.locator('[data-ui="open-onboarding"]').waitFor({ state: 'attached' });
    assert.equal(await signedOutPanel.locator('input[type=password], form[data-form="sign-in"]').count(), 0);
    assert.equal(await signedOutPanel.getByRole('button', { name: 'Start recording', exact: true }).isDisabled(), true);
    assert.equal(await signedOutPanel.locator('[data-ui="open-main"]').isDisabled(), true);
    const locked = await app.evaluate(({ BrowserWindow, Menu }) => {
      global.__bloom.showPanel();
      global.__bloom.openMain('library');
      global.__bloom.openMain('settings');
      global.__bloom.toggleCapture();
      return {
        visible: BrowserWindow.getAllWindows().filter(w => w.isVisible()).map(w => w.webContents.getURL()),
        menus: ['recordings', 'recording-controls', 'settings'].map(id => Menu.getApplicationMenu().getMenuItemById(id).enabled),
        phase: global.__bloom.getEngine().getState().phase,
      };
    });
    assert.equal(await app.evaluate(() => global.__bloom.hasTray()), false);
    assert.equal(locked.phase, 'idle');
    assert.deepEqual(locked.menus, [false, false, false]);
    assert.ok(locked.visible.every(url => url.includes('surface=onboarding')));
    assert.equal(app.windows().some(p => p.url().includes('surface=workspace')), false);
    await onboarding.getByLabel('VideoDB API key').waitFor();
    assert.equal(await onboarding.getByRole('button', { name: 'Next', exact: true }).count(), 0);
    await onboarding.evaluate(() => document.fonts.ready);
    // Let the native window finish its first paint before collecting visual evidence.
    await onboarding.waitForTimeout(1000);
    await onboarding.screenshot({ path: path.join(evidence, `${theme}-connect.png`) });
    await app.evaluate(({ shell }) => {
      global.__originalOpenExternal = shell.openExternal;
      shell.openExternal = async (url) => { global.__openedKeyUrl = url; };
    });
    await onboarding.getByRole('button', { name: 'Create a VideoDB account (opens browser)', exact: true }).click();
    assert.equal(await app.evaluate(() => global.__openedKeyUrl), 'https://console.videodb.io/');
    await app.evaluate(({ shell }) => { shell.openExternal = global.__originalOpenExternal; });
    await onboarding.getByLabel('VideoDB API key').focus();
    await onboarding.screenshot({ path: path.join(evidence, `${theme}-key-focus.png`) });
    // First run is covered in depth by onboarding-ui.cjs; here it only has to hand over.
    await onboarding.getByLabel('VideoDB API key').fill('synthetic-ui-key');
    await onboarding
      .getByRole('button', { name: 'Connect to VideoDB', exact: true })
      .click();
    await onboarding
      .getByRole('heading', { name: 'You’re in control.' })
      .waitFor();
    assert.equal(await onboarding.getByRole('button', { name: 'Next', exact: true }).count(), 0);
    assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('recordings').enabled), false);
    assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('sign-out').enabled), true);
    assert.equal(await app.evaluate(() => global.__bloom.hasTray()), false);
    await onboarding.screenshot({
      path: path.join(evidence, `${theme}-onboarding.png`),
    });
    await onboarding
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
    await onboarding
      .getByRole('button', { name: 'Open Bloom', exact: true })
      .click();
    assert.equal(await app.evaluate(() => global.__bloom.hasTray()), true);
    const recorder = await windowFor('panel');
    const sourcesNow = () =>
      app.evaluate(() => global.__bloom.getEngine().getState().sources);

    // The tray is the approved icon row: no form controls, no refresh button, no title field.
    await recorder.getByRole('button', { name: 'Microphone: On' }).waitFor();
    assert.equal(await recorder.locator('select, input').count(), 0);
    assert.equal(await recorder.getByText('Refresh connection').count(), 0);
    assert.equal(await recorder.getByText('Recording title').count(), 0);
    assert.equal(await recorder.getByRole('button', { name: 'Open Bloom' }).count(), 1);
    assert.equal(await recorder.locator('[data-chooser]').count(), 0, 'no arrow without a choice');
    await recorder.getByRole('button', { name: 'Microphone: On' }).click();
    await recorder.getByRole('button', { name: 'Microphone: Off' }).waitFor();
    assert.equal((await sourcesNow()).mic, false);
    await recorder.getByRole('button', { name: 'Microphone: Off' }).click();
    await recorder.getByRole('button', { name: 'System audio: Off' }).click();
    await recorder.getByRole('button', { name: 'System audio: On' }).click();
    assert.deepEqual(
      [(await sourcesNow()).mic, (await sourcesNow()).systemAudio],
      [true, false],
    );
    await recorder.screenshot({ path: path.join(evidence, `${theme}-tray-ready.png`) });

    // A second microphone and display each add an arrow beside their icon.
    await app.evaluate(async () => {
      const fixture = global.__bloom.getFixture();
      const base = await fixture.recorder.channels();
      fixture.recorder.channels = async () => ({
        displays: [...base.displays, { id: 'display:2', name: 'Studio Display' }],
        mics: [...base.mics, { id: 'mic:2', name: 'AirPods Pro' }],
        systemAudio: base.systemAudio,
      });
      await fixture.command('checkConnection');
    });
    await recorder.getByRole('button', { name: 'Choose a microphone' }).click();
    await recorder.getByRole('button', { name: 'AirPods Pro' }).waitFor();
    await recorder.screenshot({ path: path.join(evidence, `${theme}-tray-microphones.png`) });
    await recorder.getByRole('button', { name: 'AirPods Pro' }).click();
    assert.equal((await sourcesNow()).microphone, 'mic:2');
    assert.equal(await recorder.locator('.source-list').count(), 0, 'choosing closes the list');
    assert.equal((await sourcesNow()).mic, true, 'choosing a microphone does not turn it off');
    await recorder.getByRole('button', { name: 'Choose a display' }).click();
    await recorder.screenshot({ path: path.join(evidence, `${theme}-tray-displays.png`) });
    await recorder.locator('[data-pick=screen][data-id="display:2"]').click();
    assert.equal((await sourcesNow()).screen, 'display:2');
    await recorder.getByRole('button', { name: 'Choose a display' }).click();
    await recorder.keyboard.press('Escape');
    assert.equal(await recorder.locator('.display-choices').count(), 0, 'Escape closes it');

    await recorder.locator('[data-command=start]').click();
    await phase('recording');
    // Recording: the state is in the header, a typed note becomes a mark, sources are locked.
    await recorder.locator('.ph .timer').waitFor();
    assert.equal(await recorder.getByRole('button', { name: 'Microphone: On' }).isDisabled(), true);
    await recorder.getByLabel('Mark a moment').fill('First point');
    await recorder.getByLabel('Mark a moment').press('Enter');
    await recorder.locator('.tray-marks').getByText('First point').waitFor();
    assert.equal(await recorder.getByLabel('Mark a moment').inputValue(), '', 'the note became a mark');
    await recorder.screenshot({ path: path.join(evidence, `${theme}-tray-recording.png`) });
    await recorder.getByRole('button', { name: 'Pause', exact: true }).click();
    await phase('paused');
    await recorder.getByText('Nothing is being captured.').waitFor();
    assert.equal(await recorder.locator('.ph.warn').count(), 1);
    await recorder.screenshot({ path: path.join(evidence, `${theme}-tray-paused.png`) });
    await recorder.getByRole('button', { name: 'Resume', exact: true }).click();
    await phase('recording');
    await recorder
      .getByRole('button', { name: 'Stop recording', exact: true })
      .click();
    await phase('saving');
    // Saving: one card with its steps, no raw stage names and no second "pending" card.
    await recorder.locator('.stages').waitFor();
    assert.equal(await recorder.getByText('Pending recordings').count(), 0);
    assert.equal(await recorder.getByText(/awaiting_token|uploading$/).count(), 0);
    assert.equal(await recorder.getByRole('button', { name: /Retry/ }).count(), 0);
    await recorder.screenshot({ path: path.join(evidence, `${theme}-tray-saving.png`) });
    assert.equal(
      await app.evaluate(
        () => global.__bloom.getEngine().getState().result,
      ),
      null,
    );
    await app.evaluate(() => global.__bloom.getFixture().recorder.finish());
    await phase('finished');
    assert.equal(await app.evaluate(() => global.__bloom.hasTray()), true);
    assert.equal(await recorder.getByText('Ready to play').count(), 1);
    assert.equal(await recorder.getByRole('button', { name: /Start recording/ }).count(), 1, 'the next recording is one click away');
    await recorder.screenshot({ path: path.join(evidence, `${theme}-tray-finished.png`) });
    const panel = await windowFor('panel');
    await panel
      .getByRole('button', { name: 'Open recording', exact: true })
      .waitFor();
    await panel.screenshot({ path: path.join(evidence, `${theme}-panel.png`) });
    assert.equal(await panel.locator('input[type=password]').count(), 0);
    await panel
      .getByRole('button', { name: 'Open recording', exact: true })
      .click();
    const main = await windowFor('workspace');
    await main.getByText('Recorded words', { exact: true }).waitFor();
    assert.equal(
      await main.getByRole('button', { name: 'Edit', exact: true }).count(),
      0,
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-workspace.png`),
    });
    // The approved main window: one primary action, the rest under a menu, no form-era controls.
    assert.equal(await main.getByRole('button', { name: 'Copy link', exact: true }).count(), 1);
    assert.equal(await main.getByText('Refresh playback').count(), 0);
    assert.equal(await main.getByRole('button', { name: 'Refresh', exact: true }).count(), 0);
    assert.equal(await main.getByRole('button', { name: 'Recording controls' }).count(), 0);
    assert.equal(await main.getByRole('button', { name: 'New recording', exact: true }).count(), 1);
    assert.equal(await main.locator('.record-row small').first().innerText().then((t) => /Ready/.test(t)), false);
    await main.locator('[data-list=order]').selectOption('name');
    await main.locator('[data-list=order]').selectOption('newest');
    await main.locator('.record-menu summary').click();
    await main.getByRole('button', { name: 'Rename', exact: true }).click();
    await main
      .locator('dialog input[name=title]')
      .fill('Acknowledged recording');
    await main
      .locator('dialog')
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await main
      .getByRole('heading', { name: 'Acknowledged recording', exact: true })
      .waitFor();
    await main.getByRole('button', { name: 'Settings', exact: true }).click();
    await main
      .getByRole('heading', { name: 'Settings', exact: true })
      .waitFor();
    await main.getByLabel('Microphone on by default').uncheck();
    assert.equal(
      await app.evaluate(() => global.__bloom.getPrefs().defaultMic),
      false,
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-settings.png`),
    });
    await Promise.all([main.waitForEvent('close'), main.getByRole('button', { name: 'Sign out', exact: true }).click()]);
    assert.equal(await app.evaluate(() => global.__bloom.hasTray()), false);
    const reconnect = await windowFor('onboarding');
    await reconnect.getByLabel('VideoDB API key').waitFor();
    await app.evaluate(() => global.__bloom.openMain('library'));
    assert.equal(app.windows().some(p => p.url().includes('surface=workspace')), false);
    assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('recordings').enabled), false);
    assert.deepEqual(errors, []);
    console.log(
      `Connected ${theme} walkthrough passes with fake recorder, no live API or screen capture.`,
    );
  } finally {
    await app
      .evaluate(() => global.__bloom.getEngine().dispose())
      .catch(() => {});
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    try {
      app.process().kill('SIGKILL');
    } catch {
      // already gone
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
