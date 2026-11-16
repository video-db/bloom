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
    await signedOutPanel
      .locator('[data-ui="open-onboarding"]')
      .waitFor({ state: 'attached' });
    assert.equal(
      await signedOutPanel
        .locator('input[type=password], form[data-form="sign-in"]')
        .count(),
      0,
    );
    assert.equal(
      await signedOutPanel
        .getByRole('button', { name: 'Start recording', exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await signedOutPanel.locator('[data-ui="open-main"]').isDisabled(),
      true,
    );
    const locked = await app.evaluate(({ BrowserWindow, Menu }) => {
      global.__bloom.showPanel();
      global.__bloom.openMain('home');
      global.__bloom.openMain('settings');
      global.__bloom.toggleCapture();
      return {
        visible: BrowserWindow.getAllWindows()
          .filter((w) => w.isVisible())
          .map((w) => w.webContents.getURL()),
        menus: ['recordings', 'recording-controls', 'settings'].map(
          (id) => Menu.getApplicationMenu().getMenuItemById(id).enabled,
        ),
        phase: global.__bloom.getEngine().getState().phase,
      };
    });
    assert.equal(await app.evaluate(() => global.__bloom.hasTray()), false);
    assert.equal(locked.phase, 'idle');
    assert.deepEqual(locked.menus, [false, false, false]);
    assert.ok(
      locked.visible.every((url) => url.includes('surface=onboarding')),
    );
    assert.equal(
      app.windows().some((p) => p.url().includes('surface=workspace')),
      false,
    );
    await onboarding.getByLabel('VideoDB API key').waitFor();
    assert.equal(
      await onboarding
        .getByRole('button', { name: 'Next', exact: true })
        .count(),
      0,
    );
    await onboarding.evaluate(() => document.fonts.ready);
    // Let the native window finish its first paint before collecting visual evidence.
    await onboarding.waitForTimeout(1000);
    await onboarding.screenshot({
      path: path.join(evidence, `${theme}-connect.png`),
    });
    await app.evaluate(({ shell }) => {
      global.__originalOpenExternal = shell.openExternal;
      shell.openExternal = async (url) => {
        global.__openedKeyUrl = url;
      };
    });
    await onboarding
      .getByRole('button', {
        name: 'Create a VideoDB account (opens browser)',
        exact: true,
      })
      .click();
    assert.equal(
      await app.evaluate(() => global.__openedKeyUrl),
      'https://console.videodb.io/',
    );
    await app.evaluate(({ shell }) => {
      shell.openExternal = global.__originalOpenExternal;
    });
    await onboarding.getByLabel('VideoDB API key').focus();
    await onboarding.screenshot({
      path: path.join(evidence, `${theme}-key-focus.png`),
    });
    // First run is covered in depth by onboarding-ui.cjs; here it only has to hand over.
    await onboarding.getByLabel('VideoDB API key').fill('synthetic-ui-key');
    await onboarding
      .getByRole('button', { name: 'Connect to VideoDB', exact: true })
      .click();
    await onboarding
      .getByRole('heading', { name: 'You’re in control.' })
      .waitFor();
    assert.equal(
      await onboarding
        .getByRole('button', { name: 'Next', exact: true })
        .count(),
      0,
    );
    assert.equal(
      await app.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu().getMenuItemById('recordings').enabled,
      ),
      false,
    );
    assert.equal(
      await app.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu().getMenuItemById('sign-out').enabled,
      ),
      true,
    );
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
    assert.equal(
      await recorder.getByRole('button', { name: 'Open Bloom' }).count(),
      1,
    );
    assert.equal(
      await recorder.locator('[data-chooser]').count(),
      0,
      'no arrow without a choice',
    );
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
    await recorder.screenshot({
      path: path.join(evidence, `${theme}-tray-ready.png`),
    });

    // A second display adds an arrow beside its icon. The microphone has no chooser:
    // recording uses the Mac's default microphone.
    await app.evaluate(async () => {
      const fixture = global.__bloom.getFixture();
      const base = await fixture.recorder.channels();
      fixture.recorder.channels = async () => ({
        displays: [
          ...base.displays,
          { id: 'display:2', name: 'Studio Display' },
        ],
        mics: base.mics,
        systemAudio: base.systemAudio,
      });
      global.__bloom.showPanel();
    });
    await recorder
      .getByRole('button', { name: 'Choose what to record' })
      .waitFor();
    assert.equal(
      await recorder
        .getByRole('button', { name: 'Choose a microphone' })
        .count(),
      0,
    );
    // Choosing a single window: the chooser's second list, grouped by app.
    await recorder
      .getByRole('button', { name: 'Choose what to record' })
      .click();
    await recorder
      .getByRole('button', { name: 'Windows', exact: true })
      .click();
    await recorder.locator('.window-row').nth(2).waitFor();
    assert.deepEqual(await recorder.locator('.window-app').allInnerTexts(), [
      'Google Chrome',
      'Figma',
    ]);
    await recorder.screenshot({
      path: path.join(evidence, `${theme}-tray-windows.png`),
    });
    await recorder.locator('.window-row', { hasText: 'Checkout flow' }).click();
    assert.match(
      await recorder.locator('.source-what').innerText(),
      /Window · Figma · Checkout flow/,
    );
    assert.equal((await sourcesNow()).window, 'window:c');
    await recorder.screenshot({
      path: path.join(evidence, `${theme}-tray-window-chosen.png`),
    });
    // If that window closes, Bloom says so and asks again; it never records the display instead.
    await app.evaluate(() => {
      const fake = global.__bloom.getFixture().recorder;
      fake.openWindows = fake.openWindows.filter((w) => w.id !== 'window:c');
    });
    await recorder.getByRole('button', { name: /Start recording/ }).click();
    await recorder
      .getByText('That window has closed. Choose what to record.')
      .waitFor();
    assert.equal(
      await app.evaluate(() => global.__bloom.getEngine().getState().phase),
      'idle',
    );
    assert.equal((await sourcesNow()).window, '');
    await recorder
      .getByRole('button', { name: 'Choose what to record' })
      .click();
    await recorder
      .getByRole('button', { name: 'Displays', exact: true })
      .click();
    await recorder.screenshot({
      path: path.join(evidence, `${theme}-tray-displays.png`),
    });
    await recorder.locator('[data-pick=screen][data-id="display:2"]').click();
    assert.equal((await sourcesNow()).screen, 'display:2');
    await recorder
      .getByRole('button', { name: 'Choose what to record' })
      .click();
    await recorder.keyboard.press('Escape');
    assert.equal(
      await recorder.locator('.display-choices').count(),
      0,
      'Escape closes it',
    );

    await recorder.locator('[data-command=start]').click();
    await phase('recording');
    // Recording: the state is in the header, a typed note becomes a mark. A sound source
    // that is being recorded can be muted and brought back; the choice of sources is locked.
    await recorder.locator('.ph .timer').waitFor();
    await recorder.getByRole('button', { name: 'Mute microphone' }).click();
    await recorder.getByRole('button', { name: 'Unmute microphone' }).click();
    await recorder.getByRole('button', { name: 'Mute microphone' }).waitFor();
    assert.deepEqual(
      await app.evaluate(() =>
        global.__bloom
          .getFixture()
          .calls.filter(
            ([name, tracks]) =>
              ['pause', 'resume'].includes(name) &&
              JSON.stringify(tracks) === '["mic"]',
          )
          .map(([name]) => name),
      ),
      ['pause', 'resume'],
    );
    await recorder.getByLabel('Mark a moment').fill('First point');
    await recorder.getByLabel('Mark a moment').press('Enter');
    await recorder.locator('.tray-marks').getByText('First point').waitFor();
    assert.equal(
      await recorder.getByLabel('Mark a moment').inputValue(),
      '',
      'the note became a mark',
    );
    await recorder.screenshot({
      path: path.join(evidence, `${theme}-tray-recording.png`),
    });
    await recorder.getByRole('button', { name: 'Pause', exact: true }).click();
    await phase('paused');
    await recorder.getByText('Nothing is being captured.').waitFor();
    assert.equal(await recorder.locator('.ph.warn').count(), 1);
    await recorder.screenshot({
      path: path.join(evidence, `${theme}-tray-paused.png`),
    });
    await recorder.getByRole('button', { name: 'Resume', exact: true }).click();
    await phase('recording');
    await recorder
      .getByRole('button', { name: 'Stop recording', exact: true })
      .click();
    await phase('saving');
    // The file is on this Mac: the recording shows as a card being processed, and the next
    // recording can start straight away. Nothing says upload or retry.
    await recorder.locator('.tray-card', { hasText: 'Processing' }).waitFor();
    assert.equal(
      await recorder
        .getByRole('button', { name: /Start recording/ })
        .isEnabled(),
      true,
    );
    assert.equal(await recorder.locator('.ph.warn').count(), 0);
    assert.equal(
      await recorder
        .getByText(/upload|retry|awaiting_token|Still saving/i)
        .count(),
      0,
    );
    assert.equal(await recorder.locator('.stages').count(), 0);
    await recorder.screenshot({
      path: path.join(evidence, `${theme}-tray-processing.png`),
    });
    // If processing fails, the recording waits to be recovered and still does not block Start.
    await app.evaluate(() => {
      const { recorder: fake } = global.__bloom.getFixture();
      fake.emit('recording-relay-failed', { sessionId: fake.active });
    });
    await phase('processing-error');
    await recorder.getByText('Needs recovery', { exact: true }).waitFor();
    assert.equal(
      await recorder
        .getByRole('button', { name: 'Recover', exact: true })
        .count(),
      1,
    );
    assert.equal(
      await recorder
        .getByRole('button', { name: /Start recording/ })
        .isEnabled(),
      true,
    );
    assert.equal(
      await recorder.locator('.ph.warn').count(),
      0,
      'a recording needing recovery does not take over the panel',
    );
    await recorder.screenshot({
      path: path.join(evidence, `${theme}-tray-recovery.png`),
    });
    await recorder
      .getByRole('button', { name: 'Recover', exact: true })
      .click();
    await phase('saving');
    assert.equal(
      await app.evaluate(() => global.__bloom.getEngine().getState().result),
      null,
    );
    await app.evaluate(() => global.__bloom.getFixture().recorder.finish());
    await phase('finished');
    assert.equal(await app.evaluate(() => global.__bloom.hasTray()), true);
    assert.equal(await recorder.getByText('Ready to play').count(), 1);
    assert.equal(
      await recorder.getByRole('button', { name: /Start recording/ }).count(),
      1,
      'the next recording is one click away',
    );
    await recorder.screenshot({
      path: path.join(evidence, `${theme}-tray-finished.png`),
    });
    const panel = await windowFor('panel');
    await panel
      .getByRole('button', { name: 'Open recording', exact: true })
      .waitFor();
    await panel.screenshot({ path: path.join(evidence, `${theme}-panel.png`) });
    assert.equal(await panel.locator('input[type=password]').count(), 0);
    await panel.getByRole('button', { name: 'Copy link', exact: true }).click();
    await panel
      .getByRole('status')
      .filter({ hasText: 'Link copied.' })
      .waitFor();
    await panel
      .getByRole('button', { name: 'Open recording', exact: true })
      .click();
    const main = await windowFor('workspace');
    // A recording opens on its summary: a few sentences, key points and action items with times.
    await main.locator('#summary .points').first().waitFor();
    assert.deepEqual(await main.locator('.tab').allInnerTexts(), [
      'Summary',
      'Transcript',
      'Marks',
    ]);
    // The video is the main thing: wider than the reading column beside it, with its own
    // playbar, a timeline of the summary's chapters and the marks, and what is playing.
    const wide = (selector) =>
      main.locator(selector).evaluate((el) => el.getBoundingClientRect().width);
    assert.ok((await wide('.player')) > (await wide('.watch-read')) * 1.5);
    assert.deepEqual(
      await main
        .locator('.player-bar button')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
      ['Play', 'Playback speed', 'Full screen'],
    );
    assert.deepEqual(await main.locator('.tl-chapter').allInnerTexts(), [
      'First thought 0:00',
      'Second thought 0:04',
    ]);
    assert.match(
      await main.locator('.now-playing').innerText(),
      /Playing\s+Original/,
    );
    // A redraw (here, another tab) puts the same video element back, so playback carries on.
    await main
      .locator('[data-player]')
      .evaluate((el) => (el.dataset.kept = 'yes'));
    await main.getByRole('tab', { name: 'Marks' }).click();
    assert.equal(
      await main.locator('.player video').getAttribute('data-kept'),
      'yes',
    );
    // The timeline is a slider: the arrow keys move through the recording.
    assert.equal(await main.locator('.tl').getAttribute('role'), 'slider');
    assert.equal(
      await main.locator('.watch-text .mark-row').count(),
      await main.locator('.tl-mark').count(),
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-marks.png`),
    });
    await main.getByRole('tab', { name: 'Summary' }).click();
    // Make: the same page as a light editor. The choices say what they do in numbers,
    // and the lanes under the timeline show it.
    await main.getByRole('button', { name: 'Make', exact: true }).click();
    await main.locator('.make-panel .recipe.on').waitFor();
    // The recipe is one compact line.
    assert.ok(
      (await main
        .locator('.recipe.on')
        .evaluate((el) => el.getBoundingClientRect().height)) < 32,
    );
    const options = () =>
      main
        .locator('.opt-row')
        .evaluateAll((els) =>
          els.map((el) => [
            el.innerText.replace(/\s+/g, ' ').trim(),
            el.getAttribute('aria-checked'),
          ]),
        );
    assert.deepEqual(await options(), [
      ['✓ Remove 2 silences saves 0:06', 'true'],
      ['✓ Subtitles', 'true'],
      ['✓ Title', 'true'],
      ['✓ Chapters 2 chapters', 'true'],
      ['End card', 'false'],
    ]);
    assert.match(
      await main.locator('.make-length').innerText(),
      /0:03\s+from 0:10/,
    );
    assert.equal(await main.locator('.tl-cut').count(), 2);
    assert.equal(await main.locator('.lane i.x').count(), 2);
    assert.equal(await main.locator('.lane i.t').count(), 1);
    // The lanes start where the timeline does, so a cut sits above its block.
    const left = (selector) =>
      main
        .locator(selector)
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().left));
    assert.equal(await left('.tl-track'), await left('.lane'));
    await main.screenshot({ path: path.join(evidence, `${theme}-make.png`) });
    // A choice that is off empties its lane and the length says so.
    await main.getByRole('checkbox', { name: /Remove 2 silences/ }).click();
    assert.equal(await main.locator('.tl-cut').count(), 0);
    assert.match(
      await main.locator('.make-length').innerText(),
      /0:10\s+from 0:10/,
    );
    await main.getByRole('checkbox', { name: /Remove 2 silences/ }).click();
    // The title has three styles. The chosen one is drawn over the picture at the start,
    // and a card says in the length that it adds time.
    assert.deepEqual(
      await main.locator('.title-styles button').allInnerTexts(),
      ['Over video', 'Opening card', 'Lower third'],
    );
    assert.equal(await main.locator('.title-preview.over').count(), 1);
    await main.getByRole('button', { name: 'Lower third' }).click();
    assert.equal(await main.locator('.title-preview.third').count(), 1);
    await main.getByRole('button', { name: 'Opening card' }).click();
    assert.equal(await main.locator('.title-preview.card').count(), 1);
    assert.equal(await main.locator('.lane i.t.card').count(), 1);
    assert.match(
      await main.locator('.make-length').innerText(),
      /0:06\s+from 0:10 · includes the opening card/,
    );
    await main.getByLabel('Title text').fill('Two thoughts');
    // An end card is off until asked for, and has its own words.
    await main.getByRole('checkbox', { name: 'End card' }).click();
    await main.getByLabel('End card text').fill('Thanks for watching');
    await main.getByRole('checkbox', { name: 'Subtitles' }).click();
    await main.getByRole('checkbox', { name: 'Subtitles' }).click();
    assert.match(
      await main.locator('.make-length').innerText(),
      /0:09\s+from 0:10 · includes the opening and end cards/,
    );
    assert.equal(await main.locator('.lane i.t.card').count(), 2);
    assert.equal(
      await main.getByLabel('End card text').inputValue(),
      'Thanks for watching',
      'typed words survive a redraw',
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-make-titles.png`),
    });
    await main.getByRole('button', { name: 'Make video' }).click();
    // The version is made: back in Watch with it playing, the original one click away.
    await main
      .locator('.now-playing .version.on', { hasText: 'Walkthrough' })
      .waitFor();
    assert.deepEqual(
      await main
        .locator('.now-playing .version')
        .evaluateAll((els) =>
          els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
        ),
      ['Original 0:10', 'Walkthrough 0:09 Ready'],
    );
    const asked = await app.evaluate(
      () =>
        global.__bloom
          .getFixture()
          .calls.find(([name]) => name === 'makeVersion')[1],
    );
    assert.equal(asked.title, 'Two thoughts');
    assert.equal(asked.titleStyle, 'card');
    assert.equal(asked.endText, 'Thanks for watching');
    assert.equal(asked.subtitles, true);
    assert.equal(asked.ranges.length, 2);
    assert.match(
      await main.locator('[data-player-time]').innerText(),
      /\/ 0:09/,
      "the player and timeline are the version's",
    );
    // What a version is, in plain words for whoever opens it. Nowhere does the window
    // say where a recording or a version is kept.
    await main.locator('.versions-note summary').click();
    assert.match(
      await main.locator('.versions-note').innerText(),
      /A version is a new video made from this recording[\s\S]*The original is never changed/,
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-version.png`),
    });
    assert.doesNotMatch(
      await main.locator('body').innerText(),
      /this Mac|your Mac|the file\b/i,
    );
    // Copy link copies what is playing.
    await main
      .getByRole('button', { name: 'Copy link', exact: true })
      .first()
      .click();
    assert.match(
      await app.evaluate(({ clipboard }) => clipboard.readText()),
      /^https:\/\/player\.example\/version-/,
    );
    await main.getByRole('button', { name: 'Original' }).click();
    assert.match(
      await main.locator('[data-player-time]').innerText(),
      /\/ 0:10/,
    );
    // Removing a version says what goes and what stays, and leaves the original.
    await main.getByRole('button', { name: /Walkthrough/ }).click();
    await main.locator('.version-menu summary').click();
    await main.getByRole('button', { name: 'Remove version…' }).click();
    assert.match(
      await main.locator('dialog').innerText(),
      /original recording is not affected[\s\S]*keeps working/,
    );
    await main
      .locator('dialog')
      .getByRole('button', { name: 'Remove' })
      .click();
    await main
      .locator('.now-playing .version.on', { hasText: 'Original' })
      .waitFor();
    assert.equal(await main.locator('.now-playing .version').count(), 1);
    assert.match(
      await main.locator('#summary').innerText(),
      /A short walk through two thoughts\./,
    );
    assert.deepEqual(await main.locator('#summary .ts').allInnerTexts(), [
      '0:00',
      '0:04',
    ]);
    await main.screenshot({
      path: path.join(evidence, `${theme}-summary.png`),
    });
    await main.getByRole('tab', { name: 'Transcript' }).click();
    await main.locator('.para').first().waitFor();
    // The transcript reads as paragraphs, each starting with its time.
    assert.equal(await main.locator('#transcript .para').count(), 2);
    assert.deepEqual(await main.locator('#transcript .ts').allInnerTexts(), [
      '0:00',
      '0:04',
    ]);
    assert.match(
      await main.locator('#transcript .para').first().innerText(),
      /Recorded words here\.$/,
    );
    assert.equal(
      await main.getByRole('button', { name: 'Edit', exact: true }).count(),
      0,
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-workspace.png`),
    });
    // The approved main window: one primary action, the rest under a menu, no form-era controls.
    assert.equal(
      await main
        .getByRole('button', { name: 'Copy link', exact: true })
        .count(),
      1,
    );
    assert.equal(await main.getByText('Refresh playback').count(), 0);
    assert.equal(
      await main.getByRole('button', { name: 'Refresh', exact: true }).count(),
      0,
    );
    assert.equal(
      await main.getByRole('button', { name: 'Recording controls' }).count(),
      0,
    );
    assert.equal(
      await main
        .getByRole('button', { name: 'New recording', exact: true })
        .count(),
      1,
    );
    // The app shell: places in the sidebar, no recording list beside the page.
    assert.deepEqual(
      await main
        .locator('.sidebar .place > span:first-of-type')
        .allInnerTexts(),
      ['Home', 'Recordings', 'Search'],
    );
    // The account's collections and balance, from VideoDB.
    const collections = await main
      .locator('.collection > span:first-child')
      .allInnerTexts();
    assert.deepEqual(collections.slice(0, 2), [
      'Bloom Recordings',
      'Product reviews',
    ]);
    assert.equal(collections.length, 32);
    // A long list scrolls by itself; it never squeezes the places above it.
    assert.deepEqual(
      await main
        .locator('.sidebar .place')
        .evaluateAll((els) => els.map((el) => el.offsetHeight)),
      [32, 32, 32],
    );
    assert.equal(
      await main
        .locator('.collections')
        .evaluate((el) => el.scrollHeight > el.clientHeight),
      true,
    );
    assert.match(
      await main.locator('.balance').innerText(),
      /Credits\s*316\.28/,
    );
    await main
      .locator('.sidebar-footer')
      .screenshot({ path: path.join(evidence, `${theme}-credits.png`) });
    assert.equal(
      await main
        .locator('.sidebar [aria-current=page]')
        .innerText()
        .then((t) => /Recordings/.test(t)),
      true,
      'an open recording belongs to Recordings',
    );
    assert.equal(
      await main.locator('.record-row, .browser, [data-query]').count(),
      0,
    );
    await main.getByRole('button', { name: 'Home', exact: true }).click();
    await main.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    assert.equal(await main.locator('.stat').count(), 2);
    assert.equal(await main.locator('.recent-row').count(), 1);
    await main.screenshot({ path: path.join(evidence, `${theme}-home.png`) });
    await main.locator('.sidebar .place', { hasText: 'Recordings' }).click();
    await main
      .getByRole('heading', { name: 'Recordings', exact: true })
      .waitFor();
    assert.equal(
      await main
        .locator('.tile small')
        .first()
        .innerText()
        .then((t) => /Ready/.test(t)),
      false,
    );
    // In date order the tiles are grouped as Finder names them.
    assert.deepEqual(await main.locator('.tile-group .label').allInnerTexts(), [
      'Today',
    ]);
    // Filter and sort sit behind one icon, with the same options as before.
    const browse = async (name) => {
      await main.locator('.browse-menu summary').click();
      await main.getByRole('menuitemradio', { name, exact: true }).click();
    };
    await main.locator('.browse-menu summary').click();
    assert.deepEqual(
      await main
        .locator('.browse-menu [role=menuitemradio]')
        .evaluateAll((els) =>
          els.map((el) => [
            el.innerText.trim(),
            el.getAttribute('aria-checked'),
          ]),
        ),
      [
        ['All', 'true'],
        ['Processing', 'false'],
        ['Needs attention', 'false'],
        ['Newest', 'true'],
        ['Oldest', 'false'],
        ['A–Z', 'false'],
        ['Longest', 'false'],
      ],
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-recordings-menu.png`),
    });
    await main.getByRole('menuitemradio', { name: 'A–Z', exact: true }).click();
    assert.equal(
      await main.locator('.tile-group').count(),
      0,
      'no date groups',
    );
    await browse('Newest');
    await browse('Processing');
    await main.getByText('Nothing here', { exact: true }).waitFor();
    assert.equal(
      await main.locator('.browse-dot').count(),
      1,
      'a filter is on',
    );
    await browse('All');
    assert.equal(await main.locator('.browse-dot').count(), 0);
    await main.screenshot({
      path: path.join(evidence, `${theme}-recordings.png`),
    });
    await main.route('https://images.example/shelf-1.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#557080"/></svg>',
      }),
    );
    // Another collection opens read-only: its videos can be played and read, not changed.
    await main.locator('.collection', { hasText: 'Product reviews' }).click();
    await main
      .getByRole('heading', { name: 'Product reviews', exact: true })
      .waitFor();
    await main.locator('.tile').nth(1).waitFor();
    assert.equal(await main.locator('.tile').count(), 2);
    await main.waitForFunction(
      () => document.querySelector('.tile .shot img')?.naturalWidth > 0,
    );
    await main.waitForFunction(
      () => !document.querySelector('.tile:nth-child(2) .shot img'),
    );
    assert.equal(await main.locator('.tile .shot').count(), 2);
    assert.equal(
      await main.locator('.sidebar .place.on').count(),
      0,
      'no place is lit while a collection is browsed',
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-collection.png`),
    });
    await main.locator('.tile', { hasText: 'Design critique' }).click();
    await main
      .getByRole('heading', { name: 'Design critique', exact: true })
      .waitFor();
    assert.equal(await main.locator('.record-menu').count(), 0);
    assert.equal(
      await main
        .getByRole('button', { name: 'Copy link', exact: true })
        .count(),
      1,
    );
    assert.match(await main.locator('.crumb').innerText(), /Product reviews/);
    await main.getByRole('button', { name: 'Copy link', exact: true }).click();
    await main
      .getByRole('status')
      .filter({ hasText: 'Link copied.' })
      .waitFor();
    // Exercise the native menu callbacks without depending on OS menu automation.
    await app.evaluate(({ Menu }) => {
      global.__originalMenuBuilder = Menu.buildFromTemplate;
      Menu.buildFromTemplate = (template) => ({
        popup() {
          global.__collectionMenu = template;
        },
      });
    });
    const chooseCollectionAction = async (label) => {
      await app.evaluate((_electron, label) => {
        global.__collectionMenu.find((item) => item.label === label).click();
      }, label);
    };
    await main
      .locator('[data-collection="collection-2"]')
      .click({ button: 'right' });
    await chooseCollectionAction('Rename…');
    await main.getByRole('dialog').waitFor();
    await main.getByLabel('Collection name').fill('Reviewed demos');
    await main.screenshot({
      path: path.join(evidence, `${theme}-rename-collection.png`),
    });
    await main.getByRole('button', { name: 'Save', exact: true }).click();
    await main.locator('.collection', { hasText: 'Reviewed demos' }).waitFor();
    await main
      .locator('[data-collection="collection-2"]')
      .click({ button: 'right' });
    await chooseCollectionAction('Delete collection…');
    await main.getByRole('dialog').waitFor();
    await main.screenshot({
      path: path.join(evidence, `${theme}-delete-collection.png`),
    });
    await main.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(
      await main.locator('[data-collection="collection-2"]').count(),
      1,
    );
    await main
      .locator('[data-collection="collection-2"]')
      .click({ button: 'right' });
    await chooseCollectionAction('Delete collection…');
    await main
      .getByRole('button', { name: 'Delete collection', exact: true })
      .click();
    await main
      .locator('[data-collection="collection-2"]')
      .waitFor({ state: 'detached' });
    await app.evaluate(({ Menu }) => {
      Menu.buildFromTemplate = global.__originalMenuBuilder;
    });
    // Search finds a moment and opens its recording there.
    await main.locator('.sidebar .place', { hasText: 'Search' }).click();
    await main.getByRole('heading', { name: 'Search', exact: true }).waitFor();
    await main.getByLabel('Search what was said').fill('second thought');
    await main.getByLabel('Search what was said').press('Enter');
    await main.locator('.hit').first().waitFor();
    assert.equal(await main.locator('.hit').count(), 1);
    assert.equal(
      await main.getByLabel('Search what was said').inputValue(),
      'second thought',
    );
    await main.screenshot({ path: path.join(evidence, `${theme}-search.png`) });
    await main.locator('.hit').first().click();
    await main.locator('.para').first().waitFor();
    await main.locator('.sidebar .place', { hasText: 'Recordings' }).click();
    await main
      .getByRole('heading', { name: 'Recordings', exact: true })
      .waitFor();
    await main.locator('.tile').first().click();
    await main.locator('.para').first().waitFor();
    assert.equal(await main.locator('.watch .player').count(), 1);
    await main
      .getByRole('button', { name: 'Recordings', exact: true })
      .first()
      .waitFor();
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
      .locator(
        '.tgl[aria-label="Microphone on by default"][aria-pressed="false"]',
      )
      .waitFor();
    assert.equal(
      (await main.locator('.set .srow').count()) >= 10,
      true,
      'settings rows use the approved layout',
    );
    assert.equal(
      await main.locator('.set input, .set select').count(),
      0,
      'no bare form controls',
    );
    assert.equal(
      await app.evaluate(() => global.__bloom.getPrefs().defaultMic),
      false,
    );
    // Settings says nothing about where recordings are kept.
    assert.equal(await main.getByText('Where recordings go').count(), 0);
    assert.equal(
      await main.getByRole('heading', { name: 'Permissions' }).count(),
      1,
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-settings.png`),
    });
    await Promise.all([
      main.waitForEvent('close'),
      main.getByRole('button', { name: 'Sign out', exact: true }).click(),
    ]);
    assert.equal(await app.evaluate(() => global.__bloom.hasTray()), false);
    const reconnect = await windowFor('onboarding');
    await reconnect.getByLabel('VideoDB API key').waitFor();
    await app.evaluate(() => global.__bloom.openMain('home'));
    assert.equal(
      app.windows().some((p) => p.url().includes('surface=workspace')),
      false,
    );
    assert.equal(
      await app.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu().getMenuItemById('recordings').enabled,
      ),
      false,
    );
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
