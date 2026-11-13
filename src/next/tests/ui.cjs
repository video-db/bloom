const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require(
  process.env.BLOOM_PLAYWRIGHT_MODULE || 'playwright',
);
const electronPath = process.env.BLOOM_ELECTRON_PATH || require('electron');
const workspace = path.resolve(__dirname, '../../..');
const evidence = path.resolve(
  process.env.BLOOM_UI_EVIDENCE ||
    path.join(workspace, '.context/ui-completion'),
);
fs.mkdirSync(evidence, { recursive: true });
(async () => {
  const theme = process.argv[2] || 'light';
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [
      path.join(workspace, 'src/next/main.js'),
      '--fresh',
      '--skip-onboarding',
      '--open-main',
      '--keep-open',
      '--' + theme,
    ],
  });
  const errors = [];
  app.on('window', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  const win = async (n) => {
    for (let i = 0; i < 100; i++) {
      const p = app.windows().find((p) => p.url().includes(n));
      if (p) return p;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(n);
  };
  const cmd = (name, args = {}) =>
    app.evaluate(
      (_, a) => global.__bloomNext.getEngine().command(a.name, a.args),
      { name, args },
    );
  try {
    const main = await win('main.html'),
      panel = await win('panel.html');
    await Promise.all(
      [main, panel].map((p) => p.emulateMedia({ colorScheme: theme })),
    );
    assert.equal(
      await main.evaluate(
        () => matchMedia('(prefers-color-scheme: dark)').matches,
      ),
      theme === 'dark',
    );
    await main.locator('.record-row').first().waitFor();
    assert.equal(await main.locator('.record-row').count(), 4);
    await main.screenshot({
      path: evidence + '/' + theme + '-workspace.png',
      scale: 'css',
    });
    await app.evaluate(() => global.__bloomNext.showPanel());
    await panel.locator('#purpose').waitFor();
    await panel.screenshot({
      path: evidence + '/' + theme + '-tray.png',
      scale: 'css',
    });
    const sizes = await panel.evaluate(() =>
      ['#purpose', '.capture-start'].map(
        (s) => document.querySelector(s).getBoundingClientRect().height,
      ),
    );
    assert.deepEqual(sizes, [32, 32]);
    await panel.locator('#display-picker').click();
    await panel.locator('.ph').hover();
    await panel.screenshot({
      path: evidence + '/' + theme + '-displays.png',
      scale: 'css',
    });
    await panel.locator('[data-display="2"]').click();
    await panel
      .getByRole('button', { name: 'Display 2: choose display', exact: true })
      .waitFor();
    await main.locator('#q').fill('seat');
    assert((await main.locator('.search-moments .moment-result').count()) > 0);
    await main.locator('#build-cut').click();
    await main.locator('[data-move-moment=down]').first().click();
    await main.locator('dialog [value=confirm]').click();
    await main.getByText('Search cut', { exact: false }).waitFor();
    await main.locator('.version-sources summary').click();
    assert((await main.locator('.version-sources [data-detail]').count()) > 0);
    await main.screenshot({
      path: evidence + '/' + theme + '-search-cut.png',
      scale: 'css',
    });
    await main.locator('[data-version="0"]').click();
    assert((await main.locator('#transcript').innerText()).includes('seats'));
    await main.locator('#q').fill('');
    await main.locator('[data-detail=r2]').click();
    await main.locator('#play').click();
    await main.waitForTimeout(1100);
    const time = await main.locator('#play-time').innerText();
    await cmd('renameRecording', { id: 'r3', text: 'Unrelated rename' });
    assert.equal(
      await main.locator('#play').getAttribute('aria-label'),
      'Pause sample preview',
    );
    assert.equal(await main.locator('#play-time').innerText(), time);
    await main.locator('#play').click();
    // A ready recording opens in Edit: editing is the point of the main window.
    assert.equal(
      await main.locator('[data-mode=editor]').getAttribute('aria-pressed'),
      'true',
    );
    await main.locator('[data-mode=editor]').click();
    const original = await main.locator('#transcript').innerText();
    await main.locator('#transcript').evaluate((el) => {
      const r = document.createRange();
      r.setStart(el.firstChild, 0);
      r.setEnd(el.firstChild, 12);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await main.locator('#cut-selection').click();
    assert.notEqual(await main.locator('#transcript').innerText(), original);
    await main
      .locator('#save-state')
      .getByText('Saved for this session', { exact: false })
      .waitFor();
    await main.locator('#undo-cut').click();
    assert.equal(await main.locator('#transcript').innerText(), original);
    await main.locator('#redo-cut').click();
    assert.notEqual(await main.locator('#transcript').innerText(), original);
    // The cut button that appears on the selected words does the same job and never lingers.
    const beforeHere = await main.locator('#transcript').innerText();
    await main.locator('#transcript').evaluate((el) => {
      const r = document.createRange();
      r.setStart(el.firstChild, 0);
      r.setEnd(el.firstChild, 5);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await main.locator('#cut-here').waitFor({ state: 'visible' });
    await main.locator('#cut-here').click();
    assert.notEqual(await main.locator('#transcript').innerText(), beforeHere);
    assert(await main.locator('#cut-here').isHidden());
    await main.locator('#undo-cut').click();
    assert.equal(await main.locator('#transcript').innerText(), beforeHere);
    await main.screenshot({
      path: evidence + '/' + theme + '-edit.png',
      scale: 'css',
    });
    await main.locator('#save-version').click();
    await main.locator('#version-name').fill('Review cut');
    await main.locator('dialog [value=confirm]').click();
    await main.getByText('Review cut', { exact: true }).waitFor();
    await main.screenshot({
      path: evidence + '/' + theme + '-versions.png',
      scale: 'css',
    });
    for (const type of [
      'captions',
      'dub',
      'voice',
      'music',
      'vertical',
      'short',
    ]) {
      await main.locator('#create-version').click();
      await main.locator('#recipe-type').selectOption(type);
      await main.locator('#recipe-name').fill('Recipe ' + type);
      if (type === 'vertical')
        await main.screenshot({
          path: evidence + '/' + theme + '-recipe.png',
          scale: 'css',
        });
      await main.locator('dialog [value=confirm]').click();
      await main.getByText('Recipe ' + type, { exact: true }).waitFor();
    }
    await main.locator('[data-recipe]').first().click();
    await main.locator('#recipe-name').fill('');
    await main.locator('dialog [value=cancel]').click();
    await main.locator('dialog').waitFor({ state: 'detached' });
    await main.locator('[data-mode=review]').focus();
    await main.locator('[data-mode=review]').press('Space');
    assert.equal(
      await main.evaluate(() => document.activeElement.dataset.mode),
      'review',
    );
    await main.locator('[data-tab=versions]').click();
    for (let i = 0; i < 6; i++)
      await cmd('saveVersion', {
        id: 'r2',
        version: {
          name: 'Layout regression ' + i,
          kind: 'Edit snapshot',
          value: {
            text: 'Sample',
            cuts: { sil: false, fil: false, chap: false, cap: true },
            trim: 0,
          },
        },
      });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('main.html'))
        .setSize(960, 620),
    );
    const rowMenu = main.locator('.version-actions summary').nth(4);
    await rowMenu.evaluate((el) => {
      const pane = document.querySelector('.transcript-pane');
      pane.scrollTop +=
        el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 10;
    });
    await rowMenu.click();
    await main.waitForFunction(() => {
      const el = document.querySelector('.version-actions .record-menu[open]');
      if (!el) return false;
      const menu = el.lastElementChild.getBoundingClientRect(),
        pane = document
          .querySelector('.transcript-pane')
          .getBoundingClientRect();
      return menu.top >= pane.top && menu.bottom <= pane.bottom;
    });
    await main.locator('.transcript-pane').evaluate((el) => (el.scrollTop = 0));
    await main.locator('.version-actions summary').first().click();
    await main.locator('[data-version-action=rename]').first().click();
    await main.locator('#managed-version-name').fill('Renamed review cut');
    await main.locator('dialog [value=confirm]').click();
    await main.getByText('Renamed review cut', { exact: true }).waitFor();
    await main.locator('.version-actions summary').first().click();
    await main.locator('[data-version-action=delete]').first().click();
    await main.locator('dialog [value=confirm]').click();
    await main
      .getByText('Renamed review cut', { exact: true })
      .waitFor({ state: 'detached' });
    await main.locator('[data-view=settings]').click();
    await main
      .getByRole('heading', { name: 'Settings', exact: true })
      .waitFor();
    const pref = main.locator('[data-key=defaultMic]');
    await pref.focus();
    await pref.press('Space');
    assert.equal(
      await main.evaluate(() => document.activeElement.dataset.key),
      'defaultMic',
    );
    await main.screenshot({
      path: evidence + '/' + theme + '-settings.png',
      scale: 'css',
    });
    await main.locator('[data-go=library]').click();
    await main.locator('[data-detail=r4]').click();
    await main.locator('[data-cmd=retryRecording]').click();
    await main.locator('[data-mode=editor]:not([disabled])').waitFor();
    await main.locator('.record-menu summary').click();
    await main.locator('[data-action=rename]').click();
    await main
      .locator('#rename-title')
      .fill(
        'A long recording title that should never push toolbar controls out of the app window — final product review',
      );
    await main.locator('dialog [value=confirm]').click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('main.html'))
        .setSize(960, 620),
    );
    await main.screenshot({
      path: evidence + '/' + theme + '-compact.png',
      scale: 'css',
    });
    assert(
      await main.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const overflow = await main
      .locator('.workspace-toolbar')
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    assert(!overflow);
    await main.locator('.record-menu summary').click();
    await main.locator('[data-action=delete]').click();
    await main.locator('dialog [value=confirm]').click();
    await main.locator('[data-detail=r4]').waitFor({ state: 'detached' });
    await main.locator('[data-cmd=restoreRecording]').click();
    await main.locator('[data-detail=r4]').waitFor();
    await app.evaluate(() => global.__bloomNext.showPanel());
    await panel.locator('[data-cmd=start]').click();
    await panel.locator('[data-cmd=mark]').waitFor();
    for (let i = 0; i < 30; i++)
      await cmd('mark', {
        text:
          'Moment ' +
          i +
          ' with a long enough note to wrap gracefully in the capture panel',
      });
    const box = await panel.locator('[data-cmd=stop]').evaluate((el) => ({
      bottom: el.getBoundingClientRect().bottom,
      h: innerHeight,
    }));
    assert(box.bottom <= box.h, JSON.stringify(box));
    await panel.screenshot({
      path: evidence + '/' + theme + '-recording.png',
      scale: 'css',
    });
    await panel.locator('[data-cmd=pause]').click();
    await panel.screenshot({
      path: evidence + '/' + theme + '-paused.png',
      scale: 'css',
    });
    await panel.locator('[data-cmd=stop]').click();
    await panel.locator('[data-cmd=newRecording]').waitFor();
    await panel.screenshot({
      path: evidence + '/' + theme + '-finished.png',
      scale: 'css',
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS ' +
        theme +
        ': workspace, search cut/version, playback retained, edit/undo/redo/save, settings keyboard, retry, rename/delete/restore, compact geometry, display picker, equal field/action height, capture with 30 marks, pause/finish.',
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
