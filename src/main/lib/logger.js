'use strict';

const fs = require('fs');
const { LOG_PATH } = require('./paths');

/**
 * Append a line to the persistent log file.
 */
function logToFile(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack}`;
    if (typeof a === 'string') return a;
    return JSON.stringify(a);
  }).join(' ')}\n`;
  fs.appendFileSync(LOG_PATH(), line);
}

/**
 * Patch console.log / console.error / console.warn so every message is
 * written to both the terminal and the persistent log file.
 * Call once at startup.
 */
function initLogger() {
  const _origLog = console.log;
  const _origErr = console.error;
  const _origWarn = console.warn;

  console.log = (...args) => { _origLog(...args); logToFile(...args); };
  console.error = (...args) => { _origErr(...args); logToFile('ERROR:', ...args); };
  console.warn = (...args) => { _origWarn(...args); logToFile('WARN:', ...args); };
}

module.exports = { initLogger, logToFile };
