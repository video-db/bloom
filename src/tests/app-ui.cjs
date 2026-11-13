const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(
  process.env.BLOOM_PLAYWRIGHT_MODULE || 'playwright',
);
const root = path.resolve(__dirname, '../..');
const evidence =
  process.env.BLOOM_UI_EVIDENCE || path.join(root, '.context/app-ui');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  const theme = process.argv[2] || 'light';
  // A hung window must fail the run, not stall it.
  setTimeout(() => {
    console.error('App walkthrough timed out.');
    process.exit(2);
  }, 150000).unref();
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      path.join(root, 'src/main/index.js'),
      '--fixture',
      '--fresh',
      '--keep-open',
      `--${theme}`,
    ],
  });
  require('./helpers/style-snapshot').watchAll(app);
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
      global.__bloom.openMain('home');
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
    await panel.getByRole('button', { name: 'Copy link', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'Link copied.' }).waitFor();
    await panel
      .getByRole('button', { name: 'Open recording', exact: true })
      .click();
    const main = await windowFor('workspace');
    // A recording opens on its summary: a few sentences, key points and action items with times.
    await main.locator('#summary .points').first().waitFor();
    assert.deepEqual(await main.locator('.tab').allInnerTexts(), ['Summary', 'Transcript']);
    assert.match(await main.locator('#summary').innerText(), /A short walk through two thoughts\./);
    assert.deepEqual(await main.locator('#summary .ts').allInnerTexts(), ['0:00', '0:04']);
    await main.screenshot({ path: path.join(evidence, `${theme}-summary.png`) });
    await main.getByRole('tab', { name: 'Transcript' }).click();
    await main.locator('.para').first().waitFor();
    // The transcript reads as paragraphs, each starting with its time.
    assert.equal(await main.locator('#transcript .para').count(), 2);
    assert.deepEqual(await main.locator('#transcript .ts').allInnerTexts(), ['0:00', '0:04']);
    assert.match(await main.locator('#transcript .para').first().innerText(), /Recorded words here\.$/);
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
    // The app shell: places in the sidebar, no recording list beside the page.
    assert.deepEqual(await main.locator('.sidebar .place > span:first-of-type').allInnerTexts(), ['Home', 'Recordings', 'Search']);
    // The account's collections and balance, from VideoDB.
    const collections = await main.locator('.collection > span:first-child').allInnerTexts();
    assert.deepEqual(collections.slice(0, 2), ['Bloom Recordings', 'Product reviews']);
    assert.equal(collections.length, 32);
    // A long list scrolls by itself; it never squeezes the places above it.
    assert.deepEqual(
      await main.locator('.sidebar .place').evaluateAll((els) => els.map((el) => el.offsetHeight)),
      [32, 32, 32],
    );
    assert.equal(
      await main.locator('.collections').evaluate((el) => el.scrollHeight > el.clientHeight),
      true,
    );
    assert.match(await main.locator('.balance').innerText(), /Credits\s*316\.28/);
    await main.locator('.sidebar-footer').screenshot({ path: path.join(evidence, `${theme}-credits.png`) });
    assert.equal(await main.locator('.sidebar [aria-current=page]').innerText().then((t) => /Recordings/.test(t)), true, 'an open recording belongs to Recordings');
    assert.equal(await main.locator('.record-row, .browser, [data-query]').count(), 0);
    await main.getByRole('button', { name: 'Home', exact: true }).click();
    await main.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    assert.equal(await main.locator('.stat').count(), 2);
    assert.equal(await main.locator('.recent-row').count(), 1);
    await main.screenshot({ path: path.join(evidence, `${theme}-home.png`) });
    await main.locator('.sidebar .place', { hasText: 'Recordings' }).click();
    await main.getByRole('heading', { name: 'Recordings', exact: true }).waitFor();
    assert.equal(await main.locator('.tile small').first().innerText().then((t) => /Ready/.test(t)), false);
    await main.locator('[data-browse=order]').selectOption('name');
    await main.locator('[data-browse=order]').selectOption('newest');
    await main.getByRole('button', { name: 'Processing', exact: true }).click();
    await main.getByText('Nothing here', { exact: true }).waitFor();
    await main.getByRole('button', { name: 'All', exact: true }).click();
    await main.screenshot({ path: path.join(evidence, `${theme}-recordings.png`) });
    // Another collection opens read-only: its videos can be played and read, not changed.
    await main.locator('.collection', { hasText: 'Product reviews' }).click();
    await main.getByRole('heading', { name: 'Product reviews', exact: true }).waitFor();
    await main.locator('.tile').nth(1).waitFor();
    assert.equal(await main.locator('.tile').count(), 2);
    assert.equal(await main.locator('.sidebar .place.on').count(), 0, 'no place is lit while a collection is browsed');
    await main.screenshot({ path: path.join(evidence, `${theme}-collection.png`) });
    await main.locator('.tile', { hasText: 'Design critique' }).click();
    await main.getByRole('heading', { name: 'Design critique', exact: true }).waitFor();
    assert.equal(await main.locator('.record-menu').count(), 0);
    assert.equal(await main.getByRole('button', { name: 'Copy link', exact: true }).count(), 1);
    assert.match(await main.locator('.crumb').innerText(), /Product reviews/);
    await main.getByRole('button', { name: 'Copy link', exact: true }).click();
    await main.getByRole('status').filter({ hasText: 'Link copied.' }).waitFor();
    // Exercise the native menu callbacks without depending on OS menu automation.
    await app.evaluate(({ Menu }) => {
      global.__originalMenuBuilder = Menu.buildFromTemplate;
      Menu.buildFromTemplate = (template) => ({ popup() { global.__collectionMenu = template; } });
    });
    const chooseCollectionAction = async (label) => {
      await app.evaluate((_electron, label) => {
        global.__collectionMenu.find((item) => item.label === label).click();
      }, label);
    };
    await main.locator('[data-collection="collection-2"]').click({ button: 'right' });
    await chooseCollectionAction('Rename…');
    await main.getByRole('dialog').waitFor();
    await main.getByLabel('Collection name').fill('Reviewed demos');
    await main.screenshot({ path: path.join(evidence, `${theme}-rename-collection.png`) });
    await main.getByRole('button', { name: 'Save', exact: true }).click();
    await main.locator('.collection', { hasText: 'Reviewed demos' }).waitFor();
    await main.locator('[data-collection="collection-2"]').click({ button: 'right' });
    await chooseCollectionAction('Delete collection…');
    await main.getByRole('dialog').waitFor();
    await main.screenshot({ path: path.join(evidence, `${theme}-delete-collection.png`) });
    await main.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await main.locator('[data-collection="collection-2"]').count(), 1);
    await main.locator('[data-collection="collection-2"]').click({ button: 'right' });
    await chooseCollectionAction('Delete collection…');
    await main.getByRole('button', { name: 'Delete collection', exact: true }).click();
    await main.locator('[data-collection="collection-2"]').waitFor({ state: 'detached' });
    await app.evaluate(({ Menu }) => { Menu.buildFromTemplate = global.__originalMenuBuilder; });
    // Search finds a moment and opens its recording there.
    await main.locator('.sidebar .place', { hasText: 'Search' }).click();
    await main.getByRole('heading', { name: 'Search', exact: true }).waitFor();
    await main.getByLabel('Search what was said').fill('second thought');
    await main.getByLabel('Search what was said').press('Enter');
    await main.locator('.hit').first().waitFor();
    assert.equal(await main.locator('.hit').count(), 1);
    assert.equal(await main.getByLabel('Search what was said').inputValue(), 'second thought');
    await main.screenshot({ path: path.join(evidence, `${theme}-search.png`) });
    await main.locator('.hit').first().click();
    await main.locator('.para').first().waitFor();
    await main.locator('.sidebar .place', { hasText: 'Recordings' }).click();
    await main.getByRole('heading', { name: 'Recordings', exact: true }).waitFor();
    await main.locator('.tile').first().click();
    await main.locator('.para').first().waitFor();
    assert.equal(await main.getByText('What Bloom knows about this recording').count(), 1);
    await main.getByRole('button', { name: 'Recordings', exact: true }).first().waitFor();
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
    const micDefault = main.getByRole('button', {
      name: 'Microphone on by default',
    });
    assert.equal(await micDefault.getAttribute('aria-pressed'), 'true');
    await micDefault.click();
    await main
      .locator('.tgl[aria-label="Microphone on by default"][aria-pressed="false"]')
      .waitFor();
    assert.equal(await main.locator('.set .srow').count() >= 10, true, 'settings rows use the approved layout');
    assert.equal(await main.locator('.set input, .set select').count(), 0, 'no bare form controls');
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
    await app.evaluate(() => global.__bloom.openMain('home'));
    assert.equal(app.windows().some(p => p.url().includes('surface=workspace')), false);
    assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('recordings').enabled), false);
    assert.deepEqual(errors, []);
    console.log(
      `App ${theme} walkthrough passes with fake recorder, no live API or screen capture.`,
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
