// Help ▸ Export Diagnostics…: asks where to save the zip, writes it, and shows it in Finder.
// What goes in is listed in the README inside (diagnostics.js); recordings appear by id and
// stage only, and the account by its state only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectReport, newReportId, zip } = require('./diagnostics');

function sdkFacts() {
  try {
    const pkg = require('videodb-capture/package.json');
    return {
      sdk: pkg.version || null,
      capture: pkg.binaryConfig?.platformVersions?.[`${process.platform}-${process.arch}`] ||
        pkg.binaryConfig?.version ||
        null,
    };
  } catch {
    return { sdk: null, capture: null };
  }
}

// Everything here is a version, a state or a choice: never a key, a title or a window name.
function reportFacts({ state = {}, prefs = {}, version = '' }) {
  return {
    app: { name: 'Bloom', version, ...sdkFacts() },
    system: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      electron: process.versions.electron || null,
      node: process.versions.node,
    },
    environment: state.environment || null,
    account: {
      status: state.account?.status || null,
      method: state.account?.method || null,
    },
    recorder: { status: state.recorder?.status || null },
    permissions: state.permissions || null,
    phase: state.phase || null,
    settings: Object.fromEntries(
      Object.entries(prefs).filter(([, v]) =>
        ['boolean', 'number'].includes(typeof v) ||
        (typeof v === 'string' && v.length <= 40),
      ),
    ),
    recordings: (state.recordings || []).slice(0, 20).map((r) => ({
      id: r.id,
      status: r.status || null,
      stage: r.jobStage || r.stage || null,
      duration: Number.isFinite(r.duration) ? r.duration : null,
      createdAt: Number.isFinite(r.createdAt) ? new Date(r.createdAt).toISOString() : null,
      processed: !!r.videoId,
    })),
  };
}

function writeDiagnostics(file, { logDir, state, prefs, version, now = new Date() }) {
  const id = newReportId(now);
  const files = collectReport(id, {
    facts: reportFacts({ state, prefs, version }),
    logDir,
    now,
  });
  fs.writeFileSync(file, zip(files, now), { mode: 0o600 });
  return id;
}

async function exportDiagnostics({ dialog, shell, window, logDir, state, prefs, version, log }) {
  const day = new Date().toISOString().slice(0, 10);
  const choice = await dialog.showSaveDialog(window, {
    title: 'Export Diagnostics',
    defaultPath: path.join(os.homedir(), 'Desktop', `Bloom diagnostics ${day}.zip`),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (choice.canceled || !choice.filePath) return null;
  const id = writeDiagnostics(choice.filePath, { logDir, state, prefs, version });
  log?.('info', 'diagnostics exported', { report: id });
  shell.showItemInFolder(choice.filePath);
  return id;
}

module.exports = { exportDiagnostics, writeDiagnostics, reportFacts };
