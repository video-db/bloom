const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger, listLogFiles } = require('../main/log-files');
const { redact, unzip } = require('../main/diagnostics');
const { hookConsole } = require('../main/console-log');
const { writeDiagnostics, reportFacts } = require('../main/export-diagnostics');

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-diag-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('the log keeps one private file a day and starts a new one the next day', (t) => {
  const dir = temp(t);
  let now = new Date('2026-11-26T10:00:00');
  const log = createLogger(path.join(dir, 'bloom.log'), { fields: { v: '2.4.0', run: 'r1' }, now: () => now });
  log('info', 'first');
  now = new Date('2026-11-27T09:00:00');
  log('warn', 'second', { count: 2 });
  const names = listLogFiles(dir).map((f) => f.name);
  assert.deepEqual(names, ['bloom.log', 'bloom-2026-11-26.log']);
  const line = JSON.parse(fs.readFileSync(path.join(dir, 'bloom.log'), 'utf8'));
  assert.equal(line.msg, 'second');
  assert.equal(line.v, '2.4.0');
  assert.equal(line.count, 2);
  assert.equal(fs.statSync(path.join(dir, 'bloom.log')).mode & 0o777, 0o600);
});

test('keys, tokens, signed links and email addresses never reach a report', () => {
  const out = redact(
    'apiKey=sk-abcdefghijklmnop "token": "secret-value" Bearer abcdefghijkl https://s3.example/v.mp4?X-Amz-Signature=abc person@example.com /Users/someone/x',
    '/Users/someone',
  );
  for (const leak of ['sk-abcdefghijklmnop', 'secret-value', 'abcdefghijkl', 'X-Amz-Signature', 'person@example.com', '/Users/someone'])
    assert(!out.includes(leak), leak);
  assert(out.includes('https://s3.example/v.mp4?[query redacted]'));
  assert(out.includes('~/x'));
});

test('what main prints goes to the log, redacted, labelled and rate limited', () => {
  const lines = [];
  const target = { log() {}, info() {}, warn() {}, error() {} };
  let clock = 0;
  hookConsole((level, msg, extra) => lines.push({ level, msg, ...extra }), {
    perMin: 4,
    now: () => clock,
    target,
  });
  target.error('[Capture Binary]: Capture v0.3.6');
  target.log('[Capture Binary]: ERROR stream stalled');
  target.log('[update] apiKey=sk-abcdefghijklmnop');
  target.warn('plain');
  target.log('dropped');
  clock = 61000;
  target.log('after');
  assert.deepEqual(
    lines.map((l) => [l.level, l.msg]),
    [['info', 'capture'], ['error', 'capture'], ['info', 'update'], ['warn', 'bloom'], ['warn', 'log lines skipped'], ['info', 'bloom']],
  );
  assert(!lines[2].line.includes('sk-abcdefghijklmnop'));
});

test('the diagnostics zip holds a README, the facts and recent logs, and nothing secret', (t) => {
  const dir = temp(t);
  const logDir = path.join(dir, 'logs');
  const log = createLogger(path.join(logDir, 'bloom.log'));
  log('info', 'signed in', { line: 'token=synthetic-console-token' });
  const file = path.join(dir, 'report.zip');
  const id = writeDiagnostics(file, {
    logDir,
    version: '2.4.0',
    prefs: { defaultMic: true, appearance: 'system', note: 'x'.repeat(100) },
    state: {
      environment: 'VideoDB development',
      account: { status: 'signed-in', method: 'token', label: 'VideoDB account' },
      permissions: { screen: true, mic: false },
      recordings: [{ id: 'rec-1', title: 'Board meeting secrets', status: 'ready', duration: 12, videoId: 'm-1', createdAt: 0 }],
    },
  });
  assert.match(id, /^BL-\d{6}-[A-Z0-9]{4}$/);
  const files = unzip(fs.readFileSync(file));
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'logs/bloom.log', 'report.json']);
  const report = JSON.parse(files['report.json']);
  assert.equal(report.app.version, '2.4.0');
  assert.deepEqual(report.account, { status: 'signed-in', method: 'token' });
  assert.equal(report.recordings[0].processed, true);
  assert.equal(report.settings.note, undefined, 'long free text is left out');
  const all = Object.values(files).map(String).join('\n');
  assert(!all.includes('Board meeting secrets'));
  assert(!all.includes('synthetic-console-token'));
});

test('report facts never carry a title, a key or a window name', () => {
  const facts = reportFacts({
    state: { recordings: [{ id: 'r', title: 'Secret', windowTitle: 'Mail' }], sources: { window: 'Mail' } },
  });
  assert(!JSON.stringify(facts).includes('Secret'));
  assert(!JSON.stringify(facts).includes('Mail'));
});
