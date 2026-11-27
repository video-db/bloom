// Help ▸ Export Diagnostics…, ported from Call.md 2.0 (recorder/lib/diagnostics.js): one zip a
// person can read and choose to share. Nothing is sent anywhere. The facts come from main.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { listLogFiles } = require('./log-files');

const REPORT_DAYS = 7;
const REPORT_MAX_LOG_BYTES = 20 * 1024 * 1024; // the most log text a report carries, newest first

/** A short id a person can read out or paste: BL-YYMMDD-XXXX. */
function newReportId(now = new Date()) {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const suffix = Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
  const pad = (n) => String(n).padStart(2, '0');
  return `BL-${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${suffix}`;
}

const SECRET_KEYS = 'api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|session[_-]?token|upload[_-]?token|id[_-]?token|token|password|passwd|secret|client[_-]?secret|authorization|cookie|code[_-]?verifier';

const RULES = [
  // Bearer and basic credentials, before the key rules below take the word in front of them
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [redacted]'],
  // "apiKey": "sk-…", apiKey=…, token: …
  [new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*)"[^"]*"`, 'gi'), '$1"[redacted]"'],
  [new RegExp(`\\b((?:${SECRET_KEYS})\\s*[=:]\\s*)([^\\s,;"'&]+)`, 'gi'), '$1[redacted]'],
  // VideoDB keys and tokens (sk-…, mcp-…), JWTs
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]'],
  [/\bmcp-[A-Za-z0-9_-]{8,}/g, 'mcp-[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt redacted]'],
  // Signed and token-bearing links: keep the address, drop the query
  [/(https?:\/\/[^\s"'?#]+)\?[^\s"']*/g, '$1?[query redacted]'],
  // Email addresses
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
];

/** Removes keys, tokens, signed links and email addresses; the home folder becomes ~. */
function redact(text, home = os.homedir()) {
  let out = String(text);
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  if (home && home.length > 1) out = out.split(home).join('~');
  return out;
}

/** The newest text that fits the budget, in whole lines. */
function tailWithin(text, maxBytes) {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const tail = Buffer.from(text).subarray(-maxBytes).toString('utf8');
  const firstBreak = tail.indexOf('\n');
  return `[earlier lines left out]\n${firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail}`;
}

const README = `Bloom diagnostics report

This file helps the Bloom team understand a problem you had. Nothing here was sent
anywhere; share it only if you choose to.

What is inside
- report.json: Bloom, Electron and system versions, your computer's chip, permission
  states, your settings (choices only), whether you are signed in (never how), and the
  state of your recent recordings (ids, dates, lengths and stages, no titles).
- logs/: Bloom's logs from the last ${REPORT_DAYS} days, with what the recorder said about
  itself.

What is never included
- Your VideoDB API key or sign-in token.
- Recordings, transcripts, summaries, titles or window names.

Keys, tokens, signed links and email addresses are removed from the logs before they
are saved here, and your home folder is shown as ~. You can open every file and read it.
`;

/**
 * The report's files, keyed by their path in the zip. facts: what main knows (app, system,
 * permissions, account, settings, recordings). logDir: the folder of bloom*.log files;
 * extraLogs: other single files.
 */
function collectReport(reportId, { facts = {}, logDir = null, extraLogs = [], now = new Date(), home = os.homedir() } = {}) {
  const files = {
    'README.txt': Buffer.from(README),
    'report.json': Buffer.from(redact(JSON.stringify({ reportId, createdAt: now.toISOString(), ...facts }, null, 2), home)),
  };
  const since = new Date(now.getTime() - REPORT_DAYS * 24 * 60 * 60 * 1000);
  let budget = REPORT_MAX_LOG_BYTES;
  const add = (zipName, file) => {
    if (budget <= 0) return;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const kept = tailWithin(redact(text, home), budget);
    budget -= Buffer.byteLength(kept);
    files[zipName] = Buffer.from(kept);
  };
  if (logDir) {
    for (const f of listLogFiles(logDir)) {
      if (new Date(`${f.day}T23:59:59`) < since) continue;
      add(`logs/${f.name}`, path.join(logDir, f.name));
    }
  }
  for (const file of extraLogs) {
    try {
      if (fs.statSync(file).mtime < since) continue;
    } catch {
      continue;
    }
    add(`logs/${path.basename(file)}`, file);
  }
  return files;
}

// ------------------------------------------------------------ the zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date and time, as zip headers keep them. */
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** A zip archive of { name: Buffer }, deflated with Node's zlib: no dependency for a few text files. */
function zip(files, now = new Date()) {
  const { time, date } = dosTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** The files back out of a zip this module wrote (for the tests). */
function unzip(buf) {
  const out = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen;
    out[name] = zlib.inflateRawSync(buf.subarray(start, start + size));
    if (crc32(out[name]) !== buf.readUInt32LE(at + 14)) throw new Error(`bad crc for ${name}`);
    at = start + size;
  }
  return out;
}

module.exports = {
  REPORT_DAYS,
  REPORT_MAX_LOG_BYTES,
  README,
  newReportId,
  redact,
  tailWithin,
  collectReport,
  zip,
  unzip,
  crc32,
};
