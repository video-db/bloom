// A guard for refactors that must not change how anything looks. With BLOOM_STYLE_SNAPSHOT=1
// every walkthrough screenshot also saves the computed style and box of each element beside
// it; compare two runs with `node src/tests/helpers/compare-styles.cjs <before> <after>`.
const fs = require('node:fs');

// Runs in the page. Animations are held at their first frame so two runs read the same values.
function collect() {
  const animations = document.getAnimations();
  const resume = animations.map((a) => {
    const state = { a, time: a.currentTime, playing: a.playState === 'running' };
    try {
      a.pause();
      a.currentTime = 0;
    } catch {
      /* an animation that cannot be held is read as it is */
    }
    return state;
  });
  const read = (el, pseudo) => {
    const style = getComputedStyle(el, pseudo);
    const out = {};
    for (const name of style) out[name] = style.getPropertyValue(name);
    return out;
  };
  const elements = [...document.body.querySelectorAll('*')]
    .filter((el) => !['SCRIPT', 'STYLE'].includes(el.tagName))
    .map((el) => {
      const box = el.getBoundingClientRect();
      const entry = {
        el: `${el.tagName.toLowerCase()}.${[...el.classList].sort().join('.')}`,
        box: [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 10) / 10),
        style: read(el),
      };
      for (const pseudo of ['::before', '::after', '::placeholder']) {
        const content = getComputedStyle(el, pseudo).content;
        if (pseudo === '::placeholder' ? el.placeholder : content && content !== 'none')
          entry[pseudo] = read(el, pseudo);
      }
      return entry;
    });
  for (const { a, time, playing } of resume) {
    try {
      a.currentTime = time;
      if (playing) a.play();
    } catch {
      /* see above */
    }
  }
  // Font metrics round differently on displays of different pixel scale; record it so a
  // comparison across displays can say so instead of reporting half-pixel changes.
  return { scale: window.devicePixelRatio, elements };
}

// Makes page.screenshot({ path }) also write `<path>.styles.json`. Safe to call twice.
const watched = new WeakSet();
function watch(page) {
  if (process.env.BLOOM_STYLE_SNAPSHOT !== '1' || watched.has(page)) return;
  watched.add(page);
  const screenshot = page.screenshot.bind(page);
  page.screenshot = async (options = {}) => {
    const result = await screenshot(options);
    if (options.path)
      fs.writeFileSync(
        `${options.path}.styles.json`,
        JSON.stringify(await page.evaluate(collect)),
      );
    return result;
  };
}

// Every window of the app, including the ones opened before the test could listen.
function watchAll(app) {
  app.on('window', watch);
  const timer = setInterval(() => app.windows().forEach(watch), 50);
  timer.unref();
  app.on('close', () => clearInterval(timer));
}

module.exports = { watchAll };
