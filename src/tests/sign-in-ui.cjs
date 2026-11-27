// Sign in with VideoDB on the Connect step, with a stand-in browser: every state, in one theme.
// node src/tests/sign-in-ui.cjs light|dark   (BLOOM_PLAYWRIGHT_MODULE as for the other walkthroughs)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(
  process.env.BLOOM_PLAYWRIGHT_MODULE || 'playwright',
);

const root = path.join(__dirname, '../..');
const evidence =
  process.env.BLOOM_UI_EVIDENCE || path.join(root, '.context/sign-in-ui');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  const theme = process.argv[2] || 'light';
  setTimeout(() => {
    console.error('Sign-in walkthrough timed out.');
    process.exit(2);
  }, 90000).unref();
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      path.join(root, 'src/main/index.js'),
      '--fixture',
      '--fixture-browser',
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
  try {
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find((p) => p.url().includes('surface=onboarding'));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(page, 'onboarding window');
    await page.emulateMedia({ colorScheme: theme });
    const shot = (name) =>
      page.screenshot({ path: path.join(evidence, `${theme}-${name}.png`) });
    const button = (name) => page.getByRole('button', { name, exact: true });
    const opened = () =>
      main(() => global.__bloom.getFixture().browser.opened);

    await button('Sign in with VideoDB').waitFor();
    await shot('1-ready');

    await button('Sign in with VideoDB').click();
    await page.getByText('Waiting for your browser…').waitFor();
    assert.equal(await opened(), 1);
    await shot('2-waiting');
    await button('Open the page again').click();
    await page.waitForFunction(() => true);
    assert.equal(await opened(), 2, 'Open the page again opens the same sign-in');

    await button('Cancel').click();
    await button('Sign in with VideoDB').waitFor();
    assert.equal(await page.locator('.setup-message').count(), 0);

    await button('Sign in with VideoDB').click();
    await page.getByText('Waiting for your browser…').waitFor();
    await main(() =>
      global.__bloom
        .getFixture()
        .browser.reject('denied', 'Sign-in was cancelled in the browser.'),
    );
    await page.getByText('Sign-in was cancelled in the browser.').waitFor();
    await shot('3-cancelled-in-browser');

    await button('Use an API key instead').click();
    await page.getByLabel('VideoDB API key').waitFor();
    await shot('4-api-key');
    await button('Sign in with VideoDB instead').click();

    await button('Sign in with VideoDB').click();
    await page.getByText('Waiting for your browser…').waitFor();
    await main(() =>
      global.__bloom.getFixture().browser.resolve({
        token: 'synthetic-console-token',
        userId: 'u-synthetic',
        expiresAt: null,
      }),
    );
    await page.getByText('Connected').waitFor();
    await shot('5-connected');
    await page.getByRole('heading', { name: /permission|Allow/i }).first().waitFor({ timeout: 5000 }).catch(() => {});
    assert.deepEqual(errors, []);
    console.log(`Sign-in walkthrough passed (${theme}). Evidence: ${evidence}`);
  } finally {
    await app.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
