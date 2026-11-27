// Test windows for the recorder check: two windows whose whole picture is the time, drawn
// as a row of coloured columns a program can read back out of a recording, and a small
// window kept on top of the first one. Run by recorder-check.cjs with Electron.
//
// Across each window: [guard][24 columns, one per bit of the time in milliseconds][guard].
// A zero is blue and a one is yellow. The guard tells the windows apart: red for A,
// magenta for B. The window on top is plain green.
const { app, BrowserWindow, screen } = require('electron');

const BITS = 24;
const page = (label, guard) =>
  'data:text/html,' +
  encodeURIComponent(`<title>Bloom Check ${label}</title>
<body style="margin:0;display:flex;height:100vh;background:#000">
<script>
const cells = [];
for (let i = 0; i < ${BITS + 2}; i++) {
  const cell = document.createElement('div');
  cell.style.cssText = 'flex:1;height:100%';
  document.body.appendChild(cell);
  cells.push(cell);
}
cells[0].style.background = cells[${BITS + 1}].style.background = '${guard}';
(function draw() {
  const now = Date.now() % ${2 ** BITS};
  for (let bit = 0; bit < ${BITS}; bit++)
    cells[bit + 1].style.background =
      (now >> (${BITS - 1} - bit)) & 1 ? '#ffff00' : '#0000ff';
  requestAnimationFrame(draw);
})();
</script>`);

app.setName('Bloom Check');
app.whenReady().then(async () => {
  const windows = [
    ['A', '#ff0000', 80],
    ['B', '#ff00ff', 520],
  ].map(([label, guard, y]) => {
    const window = new BrowserWindow({
      width: 640,
      height: 360,
      x: 80,
      y,
      title: `Bloom Check ${label}`,
      webPreferences: { backgroundThrottling: false },
    });
    window.loadURL(page(label, guard));
    return window;
  });
  // Sits over the middle of window A. A recording of window A alone must not show it.
  const cover = new BrowserWindow({
    width: 160,
    height: 80,
    x: 320,
    y: 220,
    frame: false,
    focusable: false,
    alwaysOnTop: true,
    title: 'Bloom Check Cover',
  });
  cover.setAlwaysOnTop(true, 'floating');
  cover.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        '<title>Bloom Check Cover</title><body style="margin:0;background:#00ff00">',
      ),
  );
  await Promise.all(
    windows.map(
      (window) => new Promise((done) => window.once('ready-to-show', done)),
    ),
  );
  process.stdout.write(
    `READY ${JSON.stringify({
      displays: screen.getAllDisplays().map((d) => ({
        id: d.id,
        primary: d.id === screen.getPrimaryDisplay().id,
        width: d.size.width,
        height: d.size.height,
      })),
    })}\n`,
  );
});
app.on('window-all-closed', () => app.quit());
