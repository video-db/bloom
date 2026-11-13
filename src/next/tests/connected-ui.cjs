const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(
  process.env.BLOOM_PLAYWRIGHT_MODULE || 'playwright',
);
const root = path.resolve(__dirname, '../../..');
const evidence = path.join(root, '.context/connected-ui');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  const theme = process.argv[2] || 'light';
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      path.join(root, 'src/next/main/index.js'),
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
          () => global.__bloomNext.getEngine().getState().phase,
        )) === value
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Expected phase ${value}`);
  }
  try {
    const onboarding = await windowFor('onboarding');
    await app.evaluate(() => global.__bloomNext.showPanel());
    const signedOutPanel = await windowFor('panel');
    await signedOutPanel.getByRole('button', { name: 'Finish setup', exact: true }).waitFor();
    assert.equal(await signedOutPanel.locator('input[type=password], form[data-form="sign-in"]').count(), 0);
    assert.equal(await signedOutPanel.getByRole('button', { name: 'Start recording', exact: true }).isDisabled(), true);
    await signedOutPanel.screenshot({ path: path.join(evidence, `${theme}-signed-out-panel.png`) });
    await signedOutPanel.getByRole('button', { name: 'Finish setup', exact: true }).click();
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
    await onboarding.getByLabel('VideoDB API key').fill('synthetic-ui-key');
    await onboarding
      .getByRole('button', { name: 'Connect to VideoDB', exact: true })
      .click();
    await onboarding.getByRole('button', { name: 'Next', exact: true }).click();
    await onboarding
      .getByRole('heading', { name: 'You’re in control.' })
      .waitFor();
    await onboarding.screenshot({
      path: path.join(evidence, `${theme}-onboarding.png`),
    });
    await onboarding.getByRole('button', { name: 'Next', exact: true }).click();
    await onboarding.locator('[data-command=start]').click();
    await phase('recording');
    await onboarding
      .getByRole('button', { name: 'Stop recording', exact: true })
      .click();
    await phase('saving');
    assert.equal(
      await app.evaluate(
        () => global.__bloomNext.getEngine().getState().result,
      ),
      null,
    );
    await app.evaluate(() => global.__bloomNext.getFixture().recorder.finish());
    await phase('finished');
    await onboarding
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
    await onboarding.getByRole('button', { name: 'Done', exact: true }).click();
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
      await app.evaluate(() => global.__bloomNext.getPrefs().defaultMic),
      false,
    );
    await main.screenshot({
      path: path.join(evidence, `${theme}-settings.png`),
    });
    assert.deepEqual(errors, []);
    console.log(
      `Connected ${theme} walkthrough passes with fake recorder, no live API or screen capture.`,
    );
  } finally {
    await app
      .evaluate(() => global.__bloomNext.getEngine().dispose())
      .catch(() => {});
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
