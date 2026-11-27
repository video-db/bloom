// Bloom's log files, ported from Call.md 2.0: one file per day, kept for 7 days and at most
// 50 MB in all. Today's file is bloom.log; at the first line of a new day it becomes
// bloom-YYYY-MM-DD.log, and a day past 5 MB goes on in bloom-YYYY-MM-DD-2.log. Every line names
// the version and the launch it came from.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LOG_RETENTION_DAYS = 7;
const LOG_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const LOG_MAX_FILE_BYTES = 5 * 1024 * 1024;
const OLD_LOG = /^bloom-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.log$/;

/** The local calendar day, YYYY-MM-DD, that a line written at `date` belongs to. */
function logDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The log files in a folder, newest first: [{ name, day, part, size }]. Today's bloom.log is the newest. */
function listLogFiles(dir, { current = 'bloom.log', today = logDay() } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const match = OLD_LOG.exec(name);
    if (!match && name !== current) continue;
    let size = 0;
    try {
      size = fs.statSync(path.join(dir, name)).size;
    } catch {
      continue;
    }
    out.push(match ? { name, day: match[1], part: Number(match[2] || 1), size } : { name, day: today, part: Infinity, size });
  }
  return out.sort((a, b) => (a.day === b.day ? b.part - a.part : a.day < b.day ? 1 : -1));
}

/** The files to delete: older than the retention window, then the oldest until the rest fits the cap. Today's file stays. */
function filesToPrune(files, today, { days = LOG_RETENTION_DAYS, maxBytes = LOG_MAX_TOTAL_BYTES, current = 'bloom.log' } = {}) {
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const oldest = logDay(cutoff);
  const prune = [];
  let total = 0;
  for (const file of files) {
    const keep = file.name === current || (file.day >= oldest && total + file.size <= maxBytes);
    if (keep) total += file.size;
    else prune.push(file.name);
  }
  return prune;
}

/** Deletes old log files; never throws. */
function pruneLogs(dir, { today = logDay(), current = 'bloom.log' } = {}) {
  const prune = filesToPrune(listLogFiles(dir, { current, today }), today, { current });
  for (const name of prune) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      // tried again at the next rotation
    }
  }
  return prune;
}

/** A free name for a finished day's file: bloom-DAY.log, then -2, -3. */
function dayFileName(dir, day) {
  for (let n = 1; n < 1000; n += 1) {
    const name = n === 1 ? `bloom-${day}.log` : `bloom-${day}-${n}.log`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
  return `bloom-${day}-${Date.now()}.log`;
}

/** An id for this launch, so the lines of one run can be told from the next: 8 hex characters. */
function newRunId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * A JSON-lines logger with daily files. Never logs tokens: callers pass ids
 * only. fields: added to every line ({ v, run }). now: for tests.
 */
function createLogger(file, { echo = false, fields = {}, now = () => new Date() } = {}) {
  const dir = path.dirname(file);
  const current = path.basename(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // logging must never break Bloom
  }
  let day = null;
  try {
    day = logDay(fs.statSync(file).mtime);
  } catch {
    day = null; // no file yet
  }
  const roll = (finishedDay) => {
    try {
      fs.renameSync(file, path.join(dir, dayFileName(dir, finishedDay)));
    } catch {
      // the next line tries again
    }
    pruneLogs(dir, { today: logDay(now()), current });
  };
  pruneLogs(dir, { today: logDay(now()), current });
  return (level, msg, extra = {}) => {
    const at = now();
    const today = logDay(at);
    if (day && day !== today) roll(day);
    else {
      try {
        if (fs.statSync(file).size > LOG_MAX_FILE_BYTES) roll(today);
      } catch {
        // first line of the file
      }
    }
    day = today;
    const line = JSON.stringify({ at: at.toISOString(), level, msg, ...fields, ...extra });
    try {
      fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
    } catch {
      // logging must never break Bloom
    }
    if (echo) console.log(line);
  };
}

module.exports = { LOG_RETENTION_DAYS, LOG_MAX_TOTAL_BYTES, LOG_MAX_FILE_BYTES, logDay, listLogFiles, filesToPrune, pruneLogs, createLogger, newRunId };
