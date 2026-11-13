// Walks the first-run flow in the real app with a fake service and recorder: no live API,
// no screen capture, no microphone. Usage: node src/tests/onboarding-ui.cjs [light|dark]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(
  process.env.BLOOM_PLAYWRIGHT_MODULE || 'playwright',
);
const root = path.resolve(__dirname, '../..');
const evidence = path.resolve(
  process.env.BLOOM_UI_EVIDENCE || path.join(root, '.context/onboarding-ui'),
);
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  const theme = process.argv[2] || 'light';
  // A hung window must fail the run, not stall it.
  setTimeout(() => {
    console.error('Onboarding walkthrough timed out.');
    process.exit(2);
  }, 120000).unref();
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
  const main = (fn, arg) => app.evaluate(fn, arg);
  const shot = (page, name) =>
    page.screenshot({ path: path.join(evidence, `${theme}-${name}.png`) });

  try {
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find((p) => p.url().includes('surface=onboarding'));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(page, 'onboarding window');
    await page.emulateMedia({ colorScheme: theme });
    const key = page.getByLabel('VideoDB API key');
    const heading = (name) => page.getByRole('heading', { name });
    const button = (name) => page.getByRole('button', { name, exact: true });
    // The window never has OS focus under automation, so say when the person "comes back".
    const comeBack = () =>
      page.evaluate(() => window.dispatchEvent(new Event('focus')));

    // What macOS and VideoDB will answer, and what the app asked them for.
    await main(({ app: electron, shell }) => {
      const fixture = global.__bloom.getFixture();
      global.__asked = { opened: [], relaunched: 0 };
      shell.openExternal = async (url) => void global.__asked.opened.push(url);
      electron.relaunch = () => void global.__asked.relaunched++;
      global.__quit = electron.quit;
      electron.quit = () => {};
      fixture.recorder.permission = {
        screen: false,
        mic: false,
        camera: false,
      };
      global.__channels = fixture.recorder.channels;
      global.__signIn = (answer) => {
        fixture.service.signIn = () =>
          new Promise((resolve, reject) => {
            global.__answer = () =>
              answer === 'good'
                ? resolve({ scopeId: fixture.scopeId })
                : reject(
                    // The service reports failures by code, never as raw SDK errors.
                    Object.assign(new Error('synthetic'), {
                      code:
                        answer === 'wrong' ? 'authentication' : 'unavailable',
                    }),
                  );
          });
      };
    });

    // ---- 1 · Connect: empty, checking in place, wrong key, no connection ----
    await key.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await button('Connect to VideoDB').isDisabled(), true);
    assert.equal(await button('Next').count(), 0);
    await page.waitForTimeout(600);
    await shot(page, '1-connect-empty');

    await main(({ clipboard }) => {
      global.__signIn('wrong');
      clipboard.writeText('  synthetic-wrong-key \n');
    });
    await button('Paste').click(); // one click: takes the key and checks it
    await button('Connecting…').waitFor();
    assert.equal(
      await key.inputValue(),
      'synthetic-wrong-key',
      'the key stays while checking',
    );
    assert.equal(await key.isDisabled(), true);
    assert.equal(
      await heading('Your work, ready to share.').isVisible(),
      true,
      'same page',
    );
    await shot(page, '1-connect-checking');
    await main(() => global.__answer());
    await page.getByText('That key wasn’t accepted').waitFor();
    assert.equal(
      await key.inputValue(),
      'synthetic-wrong-key',
      'the wrong key is kept',
    );
    assert.equal(await key.getAttribute('aria-invalid'), 'true');
    await shot(page, '1-connect-invalid');
    // The rejected key is selected, so typing replaces it.
    await key.pressSequentially('synthetic-second-key');
    assert.equal(await key.inputValue(), 'synthetic-second-key');
    assert.equal(
      await page.getByText('That key wasn’t accepted').count(),
      0,
      'typing clears it',
    );

    await main(() => global.__signIn('offline'));
    await button('Connect to VideoDB').click();
    await main(() => global.__answer());
    await page.getByText('Can’t reach VideoDB').waitFor();
    assert.equal(
      await key.inputValue(),
      'synthetic-second-key',
      'the key is kept when offline',
    );
    await button('Try again').waitFor();
    await shot(page, '1-connect-offline');

    // ---- a good key moves on by itself; a recorder failure is not a key failure ----
    await main(() => {
      global.__signIn('good');
      global.__bloom.getFixture().recorder.channels = async () => {
        throw new Error('capture binary missing');
      };
    });
    await button('Try again').click();
    await button('Connecting…').waitFor();
    await main(() => global.__answer());
    await button('Connected').waitFor();
    await shot(page, '1-connect-connected');
    await heading('You’re in control.').waitFor({ timeout: 3000 });
    assert.equal(await main(() => global.__bloom.hasTray()), false);
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert(
      !(await alert.innerText()).includes('capture binary'),
      'no raw error text',
    );
    assert.equal(await button('Continue').isDisabled(), true);
    await shot(page, '2-recorder-failed');
    await main(() => {
      global.__bloom.getFixture().recorder.channels = global.__channels;
    });
    await alert.getByRole('button', { name: 'Try again' }).click();
    await page.getByText('While you record').waitFor();

    // ---- 2 · Permissions: ask, waiting, reopen, on; microphone turned down ----
    assert.equal(await button('Continue').isDisabled(), true);
    await shot(page, '2-permissions-ask');
    await button('Open Settings').click();
    await page.getByText('Waiting…').waitFor();
    assert(
      (await main(() => global.__asked.opened)).some((url) =>
        url.includes('Privacy_ScreenCapture'),
      ),
    );
    await shot(page, '2-permissions-waiting');
    await comeBack();
    await button('Reopen Bloom').waitFor();
    await shot(page, '2-permissions-reopen');
    await button('Reopen Bloom').click();
    assert.equal(await main(() => global.__asked.relaunched), 1);
    await main(() => {
      global.__bloom.getFixture().recorder.permission.screen = true;
    });
    await comeBack();
    await page.locator('.setup-row.on').first().waitFor();
    assert.equal(
      await page.getByText('This is what Bloom can see').count(),
      0,
      'no live view is promised when none can be shown',
    );
    assert.equal(await button('Check again').count(), 0);
    assert.equal(await button('Continue').isEnabled(), true);

    await button('Request access').click();
    await comeBack();
    await page.getByText('Off. You can record without it').waitFor();
    await shot(page, '2-permissions-mic-off');
    assert.equal(
      await button('Continue').isEnabled(),
      true,
      'the microphone is optional',
    );
    await button('Continue').click();

    // ---- 3 · Ready, and the hand-off to the menu bar ----
    await heading('A click away.').waitFor();
    assert.equal(
      await main(() => global.__bloom.getPrefs().defaultMic),
      false,
    );
    assert.equal(
      await main(() => global.__bloom.hasTray()),
      false,
      'no tray until setup ends',
    );
    await shot(page, '3-ready');
    await button('Back').click();
    await heading('You’re in control.').waitFor();
    await button('Continue').click();
    await Promise.all([
      page.waitForEvent('close'),
      button('Open Bloom').click(),
    ]);
    assert.equal(await main(() => global.__bloom.hasTray()), true);
    assert.equal(
      await main(() => global.__bloom.getPrefs().onboardingComplete),
      true,
    );
    const panel = app.windows().find((p) => p.url().includes('surface=panel'));
    await panel.emulateMedia({ colorScheme: theme });
    await panel.getByText('Start your first recording here').waitFor();
    await shot(panel, '4-panel-hint');
    await main(() => global.__bloom.getEngine().command('start'));
    await panel
      .getByText('Start your first recording here')
      .waitFor({ state: 'detached' });
    // Finish the fake recording so the app can quit without waiting on it.
    await main(async () => {
      const fixture = global.__bloom.getFixture();
      await fixture.command('stop');
      fixture.recorder.finish();
      await fixture.engine.whenIdle();
    });

    assert.deepEqual(errors, []);
    console.log(
      `Onboarding ${theme} walkthrough passes: key checked in place, automatic advance, recorder failure kept separate, reopen, optional microphone, hand-off with one hint.`,
    );
  } finally {
    await main(({ app: electron }) => {
      if (global.__quit) electron.quit = global.__quit;
      global.__bloom.getEngine().dispose();
    }).catch(() => {});
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
