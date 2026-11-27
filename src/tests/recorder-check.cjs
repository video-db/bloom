// The real recorder, checked on this Mac: what tests with a fake recorder cannot show.
//
//   node src/tests/recorder-check.cjs            window recordings of Bloom's own test windows
//   node src/tests/recorder-check.cjs --display  also 3 s of the main display (everything on it)
//   node src/tests/recorder-check.cjs --keep     keep the recorded files to look at
//
// It needs the Mac unlocked, Screen Recording allowed for the program running it (the
// terminal), Bloom quit (one recorder at a time), and ffmpeg. Nothing leaves the Mac and
// the recordings are deleted at the end. The test windows show the time as coloured
// columns (helpers/clock-windows.cjs), which is how a frame says when it was taken.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const flag = (name) => process.argv.includes(`--${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BITS = 24;
const SPAN = 2 ** BITS;
// Milliseconds from b to a, for times that wrap every SPAN.
const since = (a, b) =>
  ((((a - b) % SPAN) + SPAN + SPAN / 2) % SPAN) - SPAN / 2;
const results = [];
const say = (name, verdict, detail) => {
  results.push({ name, verdict, detail });
  console.log(`${verdict.padEnd(5)} ${name}${detail ? ` — ${detail}` : ''}`);
};

function preconditions() {
  if (process.platform !== 'darwin') throw new Error('macOS only.');
  const session = spawnSync('ioreg', ['-n', 'Root', '-d1'], {
    encoding: 'utf8',
  });
  if (/CGSSessionScreenIsLocked/.test(session.stdout || ''))
    throw new Error(
      'The screen is locked. A locked Mac has no displays to record; unlock it and run again.',
    );
  if (spawnSync('pgrep', ['-f', 'VideoDBCapture.app']).status === 0)
    throw new Error(
      'A recorder is already running (Bloom is open). Quit Bloom and run again.',
    );
  for (const tool of ['ffmpeg', 'ffprobe'])
    if (spawnSync(tool, ['-version']).status !== 0)
      throw new Error(`${tool} is needed to read the recordings.`);
}

// --- Reading the time back out of a recording -------------------------------------------
const kind = (r, g, b) =>
  r > 150 && g < 110 && b < 110
    ? 'A' // red guard
    : r > 150 && g < 120 && b > 150
      ? 'B' // magenta guard
      : r > 150 && g > 150 && b < 130
        ? 1
        : r < 130 && g < 130 && b > 140
          ? 0
          : g > 170 && r < 110 && b < 110
            ? 'cover'
            : null;

// One row of pixels → which window it is, the time it shows, and whether the cover is in it.
function readRow(row, width) {
  const at = (x) => kind(row[x * 3], row[x * 3 + 1], row[x * 3 + 2]);
  let first = -1,
    last = -1,
    cover = 0;
  for (let x = 0; x < width; x++) {
    const what = at(x);
    if (what === 'cover') cover++;
    if (what !== 'A' && what !== 'B') continue;
    if (first < 0) first = x;
    last = x;
  }
  if (first < 0 || last - first < 60) return { window: null, cover };
  const cell = (last - first + 1) / (BITS + 2);
  let time = 0;
  for (let bit = 0; bit < BITS; bit++) {
    const value = at(Math.round(first + (bit + 1.5) * cell));
    if (value !== 0 && value !== 1)
      return { window: at(first), cover, time: null };
    time = time * 2 + value;
  }
  return { window: at(first), time, cover };
}

function probe(file) {
  const out = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:frame=pts_time:format=duration',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ),
  );
  return {
    width: out.streams[0].width,
    height: out.streams[0].height,
    seconds: Number(out.format.duration),
    pts: out.frames.map((f) => Number(f.pts_time)),
  };
}

// Every frame of a window recording, read along its middle row.
function readFrames(file) {
  const info = probe(file);
  const rows = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-map',
      '0:v:0',
      '-vf',
      'format=rgb24,crop=iw:1:0:floor(ih/2)',
      '-fps_mode',
      'passthrough',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  const size = info.width * 3;
  const frames = [];
  for (let i = 0; (i + 1) * size <= rows.length; i++)
    frames.push({
      at: info.pts[i] ?? null,
      ...readRow(rows.subarray(i * size, (i + 1) * size), info.width),
    });
  return { ...info, frames };
}

// The first frame of a display recording: the test window is somewhere in it.
function readFirstFrame(file) {
  const info = probe(file);
  const frame = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  const size = info.width * 3;
  for (let y = 0; y < info.height; y += 4) {
    const read = readRow(frame.subarray(y * size, (y + 1) * size), info.width);
    if (read.window && read.time !== null) return { ...info, ...read };
  }
  return { ...info, window: null };
}

// --- The checks ---------------------------------------------------------------------------
async function main() {
  preconditions();
  const { CaptureClient } = require(
    path.join(root, 'node_modules/videodb-capture/dist/capture'),
  );
  const made = [];
  const helper = spawn(
    process.env.BLOOM_ELECTRON_PATH || require('electron'),
    [path.join(__dirname, 'helpers/clock-windows.cjs')],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const system = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(
      () => reject(new Error('The test windows did not open.')),
      20000,
    );
    helper.stdout.on('data', (chunk) => {
      text += chunk;
      const line = text.split('\n').find((l) => l.startsWith('READY '));
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice(6)));
      }
    });
    helper.on('exit', () =>
      reject(new Error('The test windows closed early.')),
    );
  });
  const client = new CaptureClient(); // standalone: no key, nothing sent anywhere
  const events = [];
  for (const name of [
    'error',
    'local-recording-failed',
    'window-closed',
    'window-suspended',
  ])
    client.on(name, (e) =>
      events.push([name, JSON.stringify(e).slice(0, 200)]),
    );
  const record = async (channelId, during) => {
    const called = Date.now();
    await client.startLocalRecording({
      channels: [{ channelId, type: 'video' }],
    });
    const returned = Date.now();
    const notes = (await during()) || {};
    const stopCalled = Date.now();
    const result = await client.stopLocalRecording();
    made.push(...(result.files || []), result.path);
    return {
      called,
      returned,
      stopCalled,
      stopped: Date.now(),
      result,
      ...notes,
    };
  };
  try {
    await sleep(1500); // the windows have drawn and are in the window list

    // Display ids: the floating control and the camera are placed by matching the
    // recorder's display to the system's.
    const channels = await client.listChannels();
    const displays = [...(channels.displays || [])].map((d) => d.id);
    const known = system.displays.map((d) => `display:${d.id}`);
    say(
      'Recorder display ids match the system display ids',
      displays.length && displays.every((id) => known.includes(id))
        ? 'PASS'
        : 'FAIL',
      `recorder ${JSON.stringify(displays)}, system ${JSON.stringify(known)}`,
    );

    // 3. The window list.
    const listed = await client.getWindows();
    const find = (label) =>
      listed.windows.find((w) => w.title === `Bloom Check ${label}`);
    const [a, b] = [find('A'), find('B')];
    say(
      'Window list: supported, with both test windows',
      listed.supported && listed.supportsDeferredWindow && a && b
        ? 'PASS'
        : 'FAIL',
      `${listed.windows.length} windows; switch ${listed.supportsSwitchWindow}, hide ${listed.supportsSetWindowEnabled}; A ${a ? `${a.width}×${a.height} onScreen ${a.isOnScreen}` : 'missing'}`,
    );
    assert.ok(a && b, 'the test windows are not in the recorder window list');

    // 1. How soon the recording starts.
    const first = await record(a.channelId, () => sleep(3000));
    const one = readFrames(first.result.path);
    const read = one.frames.filter((f) => f.window === 'A' && f.time !== null);
    assert.ok(read.length, 'no frame of the window recording could be read');
    const lateBy = since(read[0].time, first.returned % SPAN);
    const afterCall = since(read[0].time, first.called % SPAN);
    say(
      'Start: nothing after Start returned is missing',
      lateBy <= 50 ? 'PASS' : 'FAIL',
      `Start took ${first.returned - first.called} ms; the first frame is from ${afterCall} ms after Start was pressed (${lateBy} ms relative to Start returning; a frame is about 33 ms)`,
    );
    const wall = (first.stopCalled - first.returned) / 1000;
    say(
      'Window recording: a complete file of the right length',
      Math.abs(one.seconds - wall) < 0.6 &&
        read.length > one.frames.length * 0.9
        ? 'PASS'
        : 'FAIL',
      `${one.width}×${one.height}, ${one.seconds.toFixed(2)} s for ${wall.toFixed(2)} s recorded, ${one.frames.length} frames (${read.length} readable), Stop took ${first.stopped - first.stopCalled} ms`,
    );
    // 5. A window on top of the recorded one is not in a window recording, which is why
    // the floating control can sit anywhere during one.
    const covered = one.frames.filter((f) => f.cover > 20).length;
    say(
      'A window on top of the recorded window is not in the recording',
      covered === 0 ? 'PASS' : 'FAIL',
      `${covered} of ${one.frames.length} frames show the cover`,
    );

    // 2. Pause and resume.
    const second = await record(a.channelId, async () => {
      await sleep(2000);
      const paused = Date.now();
      await client.pauseTracks(['screen']);
      await sleep(3000);
      const resumed = Date.now();
      await client.resumeTracks(['screen']);
      await sleep(2000);
      return { paused, resumed };
    });
    const two = readFrames(second.result.path);
    const seen = two.frames.filter((f) => f.window === 'A' && f.time !== null);
    let jump = null, // the biggest step in shown time between two frames
      still = { ms: 0 }; // the longest run of frames showing the same time
    let run = 0;
    for (let i = 1; i < seen.length; i++) {
      const shown = since(seen[i].time, seen[i - 1].time);
      const file = (seen[i].at - seen[i - 1].at) * 1000;
      if (!jump || shown > jump.shown)
        jump = { shown, file, at: seen[i - 1].at };
      if (shown === 0) {
        run += file;
        if (run > still.ms) still = { ms: run, to: seen[i].at };
      } else run = 0;
    }
    const pausedFor = second.resumed - second.paused;
    const walled = (second.stopCalled - second.returned) / 1000;
    const kept = Math.abs(two.seconds - walled) < 0.8;
    const how =
      jump && jump.shown > pausedFor * 0.7 && jump.file > pausedFor * 0.7
        ? 'kept in the file as one held picture'
        : jump && jump.shown > pausedFor * 0.7
          ? 'cut out of the file'
          : 'not paused at all';
    say(
      'Pause and resume: the paused time is handled, and recording carries on after',
      how !== 'not paused at all' ? 'PASS' : 'FAIL',
      `paused ${pausedFor} ms at ${((second.paused - second.returned) / 1000).toFixed(1)} s: ${how}. File ${two.seconds.toFixed(2)} s for ${walled.toFixed(2)} s on the clock; biggest step ${jump?.shown} ms of shown time over ${Math.round(jump?.file)} ms of file at ${jump?.at.toFixed(2)} s; longest held picture ${Math.round(still.ms)} ms`,
    );
    // Bloom keeps where each pause was as seconds on the clock since Start. That is only
    // where the pause is in the file when the paused time stays in the file.
    say(
      'Pause positions Bloom stores match the file',
      kept && how === 'kept in the file as one held picture' ? 'PASS' : 'FAIL',
      kept
        ? 'the file is as long as the clock, so a pause is where Bloom says it is'
        : 'the file is shorter than the clock: stored pause positions must be shifted by the pauses before them',
    );

    // 4. Switching and hiding the window, without stopping.
    const third = await record(a.channelId, async () => {
      await sleep(1500);
      await client.switchWindow({ channelId: b.channelId });
      await sleep(1500);
      await client.setWindowEnabled({ enabled: false });
      await sleep(1500);
      await client.setWindowEnabled({ enabled: true });
      await sleep(1500);
    });
    const three = readFrames(third.result.path);
    const order = [];
    for (const frame of three.frames) {
      const what = frame.window || 'hidden';
      if (order.at(-1)?.what === what) order.at(-1).frames++;
      else order.push({ what, from: frame.at, frames: 1 });
    }
    const steady = order
      .filter((part) => part.frames >= 5)
      .map((part) => part.what);
    say(
      'Switch window, hide and show: A, then B, then a plain card, then B',
      steady.join(' ') === 'A B hidden B' ? 'PASS' : 'FAIL',
      `${order.map((p) => `${p.what} from ${p.from?.toFixed(1)} s (${p.frames} frames)`).join('; ')}; file ${three.seconds.toFixed(2)} s`,
    );

    // The display, only when asked: it records everything on the main display for 3 s.
    if (flag('display')) {
      const main = system.displays.find((d) => d.primary) || system.displays[0];
      const id = displays.includes(`display:${main.id}`)
        ? `display:${main.id}`
        : displays[0];
      const fourth = await record(id, () => sleep(3000));
      const shot = readFirstFrame(fourth.result.path);
      say(
        'Display recording: nothing after Start returned is missing',
        shot.window && since(shot.time, fourth.returned % SPAN) <= 50
          ? 'PASS'
          : 'FAIL',
        shot.window
          ? `Start took ${fourth.returned - fourth.called} ms; first frame from ${since(shot.time, fourth.called % SPAN)} ms after Start was pressed; ${shot.width}×${shot.height}, ${shot.seconds.toFixed(2)} s`
          : `the test window was not found in the first frame (${shot.width}×${shot.height})`,
      );
    }
    if (events.length) console.log('Recorder events:', JSON.stringify(events));
  } finally {
    await Promise.race([client.shutdown().catch(() => {}), sleep(20000)]);
    helper.kill('SIGKILL');
    if (flag('keep'))
      console.log('Kept:', [...new Set(made)].filter(Boolean).join('\n      '));
    else
      for (const file of new Set(made))
        if (file && file.startsWith(os.homedir()))
          fs.rmSync(file, { force: true });
  }
  const failed = results.filter((r) => r.verdict === 'FAIL');
  console.log(
    `\n${results.length - failed.length} of ${results.length} checks pass.${failed.length ? ` Failing: ${failed.map((r) => r.name).join('; ')}.` : ''}`,
  );
  process.exit(failed.length ? 1 : 0);
}

module.exports = { readRow, since, BITS };
if (require.main === module)
  main().catch((error) => {
    console.error(
      `Could not run: ${error.code ? `${error.code} ` : ''}${error.message}`,
    );
    process.exit(2);
  });
