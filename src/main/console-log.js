// Everything the main process prints, including what the SDK passes on from the capture program
// ("[Capture Binary]: …"), also goes to Bloom's log file. Nobody reads the console of an installed
// app, so before this a capture that failed left no trace. At most 120 lines a minute, each cut to
// 500 characters, and keys and tokens are removed before a line is written.
const { redact } = require('./diagnostics');

const LINES_PER_MIN = 120;
const LINE_MAX = 500;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g; // eslint-disable-line no-control-regex

function text(args) {
  return args
    .map((a) =>
      a instanceof Error
        ? a.message
        : typeof a === 'string'
          ? a
          : (() => {
              try {
                return JSON.stringify(a);
              } catch {
                return String(a);
              }
            })(),
    )
    .join(' ')
    .replace(ANSI, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Where a line came from, from the prefixes the SDK and Bloom use.
function sourceOf(line) {
  if (line.startsWith('[Capture Binary')) return 'capture';
  if (line.startsWith('VideoDB Capture:')) return 'capture sdk';
  const tag = /^\[([a-z-]+)\]/.exec(line);
  return tag ? tag[1] : 'bloom';
}

// The SDK prints all of the capture program's output to stderr, so its lines are judged by
// their words; Bloom's own console.error still counts as an error.
function levelOf(method, line) {
  const capture = /^(\[Capture Binary|VideoDB Capture:)/.test(line);
  if ((method === 'error' && !capture) || /\b(ERROR|FATAL)\b|panicked/.test(line))
    return 'error';
  if ((method === 'warn' && !capture) || /\bWARN(ING)?\b/.test(line)) return 'warn';
  return 'info';
}

function hookConsole(log, { perMin = LINES_PER_MIN, now = Date.now, target = console } = {}) {
  let windowStart = now();
  let written = 0;
  let skipped = 0;
  const write = (method, args) => {
    const t = now();
    if (t - windowStart >= 60000) {
      if (skipped) log('warn', 'log lines skipped', { count: skipped });
      windowStart = t;
      written = 0;
      skipped = 0;
    }
    if (written >= perMin) return void (skipped += 1);
    written += 1;
    const line = redact(text(args));
    if (!line) return;
    log(levelOf(method, line), sourceOf(line), {
      line: line.length > LINE_MAX ? `${line.slice(0, LINE_MAX)}…` : line,
    });
  };
  for (const method of ['log', 'info', 'warn', 'error']) {
    const original = target[method];
    target[method] = (...args) => {
      try {
        write(method, args);
      } catch {
        // logging must never break Bloom
      }
      return original.apply(target, args);
    };
  }
}

module.exports = { hookConsole, sourceOf, LINES_PER_MIN, LINE_MAX };
