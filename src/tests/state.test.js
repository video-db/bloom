const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSampleEngine } = require('../engine/sample');
const { createPrefs } = require('../main/prefs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test('preferences persist, reject invalid values, and do not claim a failed save', () => {
  const dir = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'bloom-prefs-test-'),
  );
  try {
    const file = path.join(dir, 'prefs.json');
    const p = createPrefs(file);
    assert(p.set('onboardingComplete', true));
    assert(p.set('appearance', 'dark'));
    assert.equal(p.set('nudgeMinutes', 12), false);
    assert.equal(createPrefs(file).all().onboardingComplete, true);
    assert.equal(createPrefs(file).all().appearance, 'dark');
    const bad = createPrefs(path.join(file, 'impossible'));
    assert.equal(bad.set('appearance', 'dark'), false);
    assert.equal(bad.all().appearance, 'system');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('permission gate, next-session defaults, reversible trim and processing retry', async () => {
  const e = createSampleEngine();
  try {
    e.command('setPermission', { key: 'screen', value: false });
    e.command('start');
    assert.equal(e.getState().phase, 'idle');
    e.command('checkPermission');
    e.command('start');
    await wait(1300);
    e.command('configure', { sources: { mic: false } });
    e.command('simulate', { kind: 'stop-failed' });
    assert.equal(e.getState().phase, 'recording');
    e.command('simulate', { kind: 'meeting-ended' });
    e.command('answerAsk', { stop: true });
    await wait(1900);
    assert.equal(e.getState().result.duration, 1930);
    assert.equal(e.getState().result.trim, 40);
    assert.equal(e.getState().recordings[0].duration, 1930);
    e.command('rename', { text: 'Keep this title' });
    await wait(2600);
    assert.equal(e.getState().result.title, 'Keep this title');
    e.command('newRecording');
    assert.equal(e.getState().sources.mic, false);
    e.command('start');
    await wait(1300);
    e.command('stop');
    e.command('simulate', { kind: 'processing-error' });
    assert.equal(e.getState().phase, 'processing-error');
    e.command('retryProcessing');
    await wait(1900);
    assert.equal(e.getState().phase, 'finished');
  } finally {
    e.dispose();
  }
});

test('processing completion updates deleted recordings before undo', async () => {
  const engine = createSampleEngine();
  try {
    engine.command('retryRecording', { id: 'r4' });
    engine.command('deleteRecording', { id: 'r4' });
    await wait(1900);
    engine.command('restoreRecording');
    assert.equal(
      engine.getState().recordings.find((r) => r.id === 'r4').status,
      'ready',
    );
  } finally {
    engine.dispose();
  }
});

test('failed processing retries the original trim and recording snapshot', async () => {
  const engine = createSampleEngine();
  try {
    engine.command('setPurpose', { text: 'Retain my title' });
    engine.command('start');
    await wait(1300);
    engine.command('simulate', { kind: 'meeting-ended' });
    engine.command('answerAsk', { stop: true });
    engine.command('simulate', { kind: 'processing-error' });
    engine.command('retryProcessing');
    await wait(1900);
    const { result, recordings } = engine.getState();
    assert.equal(result.trim, 40);
    assert.equal(result.duration, 1930);
    assert.equal(recordings[0].title, 'Retain my title');
    assert.equal(recordings[0].trim, 40);
  } finally {
    engine.dispose();
  }
});

test('source defaults do not overwrite per-session source choices', () => {
  const engine = createSampleEngine();
  try {
    engine.command('setSource', { key: 'mic', value: false });
    engine.command('configure', {
      sources: { mic: true, systemAudio: true, camera: false },
    });
    assert.equal(engine.getState().sources.mic, false);
    assert.equal(engine.getState().sources.systemAudio, true);
    engine.command('setPermission', { key: 'mic', value: true });
    assert.equal(engine.getState().sources.mic, false);
    engine.command('newRecording');
    assert.equal(engine.getState().sources.mic, true);
    assert.equal(engine.getState().sources.systemAudio, true);
  } finally {
    engine.dispose();
  }
});

test('malformed engine commands are rejected without changing state', () => {
  const engine = createSampleEngine();
  try {
    const before = JSON.stringify(engine.getState());
    for (const [command, args] of [
      ['saveDraft', { id: 'r1', draft: { text: 'x', cuts: null } }],
      [
        'saveDraft',
        { id: 'r1', draft: { text: 'x', cuts: {}, trim: Infinity } },
      ],
      ['rename', { text: null }],
      ['mark', { text: 5 }],
      ['setPurpose', { text: {} }],
      ['configure', { sources: { mic: 'false' } }],
      ['setPermission', { key: '__proto__', value: true }],
      ['setSource', { key: 'mic', value: 'false' }],
      ['start', []],
      ['__proto__', {}],
    ])
      assert.equal(engine.command(command, args), false, command);
    assert.equal(JSON.stringify(engine.getState()), before);
  } finally {
    engine.dispose();
  }
});

// Exercise lifecycle and IPC with controlled Electron objects, without an OS notification service.
async function mainHarness(prefOverrides = {}, savePreference = null) {
  const { EventEmitter } = require('node:events');
  const vm = require('node:vm');
  const windows = [],
    notifications = [],
    shortcuts = new Map(),
    messages = [];
  const app = new EventEmitter();
  Object.assign(app, {
    setName() {},
    setPath() {},
    getPath: () => '/tmp',
    whenReady: () => Promise.resolve(),
    setAboutPanelOptions() {},
    showAboutPanel() {},
    quit() {},
  });
  class Window extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.visible = false;
      this.focused = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        send: (name, value) => messages.push({ window: this, name, value }),
        isDevToolsOpened: () => false,
      });
      windows.push(this);
    }
    loadFile(file, options = {}) {
      this.file = file;
      this.surface = options.query?.surface;
      this.webContents.emit('did-start-loading');
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    isFocused() {
      return this.focused;
    }
    show() {
      this.visible = true;
    }
    // Automated runs show windows without focusing them.
    showInactive() {
      this.show();
    }
    hide() {
      this.visible = false;
      this.focused = false;
    }
    focus() {
      windows.forEach((w) => (w.focused = false));
      this.focused = true;
    }
    getSize() {
      return [340, 480];
    }
    setSize() {}
    setPosition() {}
    setVisibleOnAllWorkspaces() {}
    setBackgroundColor() {}
    close() {
      let prevented = false;
      this.emit('close', {
        preventDefault() {
          prevented = true;
        },
      });
      if (!prevented) {
        this.destroyed = true;
        this.visible = false;
        this.emit('closed');
      }
    }
    static fromWebContents(contents) {
      return windows.find((w) => w.webContents === contents);
    }
  }
  class Tray extends EventEmitter {
    getBounds() {
      return { x: 100, y: 0, width: 20, height: 20 };
    }
    setImage() {}
    setTitle() {}
    setToolTip() {}
  }
  class Notice extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.closed = false;
      notifications.push(this);
    }
    static isSupported() {
      return true;
    }
    show() {}
    close() {
      this.closed = true;
    }
  }
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => {};
  const nativeTheme = new EventEmitter();
  nativeTheme.shouldUseDarkColors = false;
  const values = { ...require('../main/prefs').DEFAULTS, ...prefOverrides };
  const electron = {
    app,
    BrowserWindow: Window,
    Tray,
    nativeImage: { createFromPath: () => ({}) },
    nativeTheme,
    ipcMain,
    Notification: Notice,
    clipboard: { writeText() {} },
    globalShortcut: {
      register: (key, callback) => shortcuts.set(key, callback),
      unregisterAll: () => shortcuts.clear(),
    },
    screen: {
      getDisplayNearestPoint: () => ({
        workArea: { x: 0, y: 20, width: 1440, height: 900 },
      }),
    },
    shell: { openExternal: () => Promise.resolve() },
    Menu: { buildFromTemplate: (x) => x, setApplicationMenu() {} },
    dialog: {
      showMessageBox: () => Promise.resolve({ response: 0 }),
      showMessageBoxSync: () => 0,
    },
  };
  const mainDir = path.resolve(__dirname, '../main');
  const context = {
    require: (name) =>
      name === 'electron'
        ? electron
        : name === '../engine'
          ? { createEngine: createSampleEngine }
          : name === './prefs'
            ? {
                createPrefs: () => ({
                  all: () => ({ ...values }),
                  set: (key, value) => {
                    if (savePreference && !savePreference(key, value))
                      return false;
                    values[key] = value;
                    return true;
                  },
                }),
              }
            : name.startsWith('./')
              ? loadMain(name)
              : require(name),
    __dirname: mainDir,
    process: {
      argv: ['node', 'main/index.js', '--fresh', '--skip-onboarding'],
      env: {},
      platform: 'darwin',
    },
    setInterval,
    clearInterval,
    console,
  };
  context.global = context;
  vm.createContext(context);
  // The main process is several modules. Each runs in this one context with its own module object,
  // so they all see the stubbed Electron and process, and every harness gets fresh copies.
  const loaded = new Map();
  function loadMain(name) {
    const file = path.join(mainDir, `${name}.js`);
    if (!loaded.has(file)) {
      const module = { exports: {} };
      loaded.set(file, module);
      vm.runInContext(
        `(function (module, exports) {${fs.readFileSync(file, 'utf8')}\n})`,
        context,
        { filename: file },
      )(module, module.exports);
    }
    return loaded.get(file).exports;
  }
  loadMain('./index');
  await new Promise((resolve) => setImmediate(resolve));
  return {
    api: context.__bloom,
    windows,
    notifications,
    shortcuts,
    messages,
    command: (window, name, args = {}) =>
      ipcMain.emit('bloom:command', { sender: window.webContents }, name, args),
    ui: (window, name, args = {}) =>
      ipcMain.emit('bloom:ui', { sender: window.webContents }, name, args),
    dispose: () => {
      app.emit('before-quit', { preventDefault() {} });
      app.emit('will-quit');
    },
  };
}

test('native panel Close hides the panel and latest main route waits for renderer readiness', async () => {
  const h = await mainHarness();
  try {
    const panel = h.windows[0];
    panel.close();
    assert.equal(panel.isDestroyed(), false);
    assert.equal(panel.isVisible(), false);
    h.api.showPanel();
    assert.equal(panel.isVisible(), true);
    h.api.openMain('home');
    h.api.openMain('settings');
    const main = h.windows.find((w) => w.surface === 'workspace');
    assert.equal(h.messages.filter((m) => m.name === 'bloom:view').length, 0);
    h.ui(main, 'main-ready');
    assert.deepEqual(
      h.messages.filter((m) => m.name === 'bloom:view').map((m) => m.value),
      ['settings'],
    );
    main.webContents.emit('did-start-loading');
    h.api.openMain('recording/r2');
    assert.equal(h.messages.filter((m) => m.name === 'bloom:view').length, 1);
    h.ui(main, 'main-ready');
    assert.equal(
      h.messages.filter((m) => m.name === 'bloom:view').at(-1).value,
      'recording/r2',
    );
  } finally {
    h.dispose();
  }
});

test('old notifications cannot affect a later capture session and Stop works after permission loss', async () => {
  const h = await mainHarness({ nudgeMinutes: 30 });
  try {
    const engine = h.api.getEngine();
    h.windows[0].hide();
    engine.command('start');
    await wait(1300);
    engine.command('simulate', { kind: 'meeting-ended' });
    const oldNotice = h.notifications.find((n) =>
      n.options.title.startsWith('Still recording'),
    );
    assert(oldNotice);
    const originalSession = engine.getState().sessionId;
    engine.command('stop');
    await wait(1900);
    engine.command('start');
    await wait(1300);
    assert.notEqual(engine.getState().sessionId, originalSession);
    assert.equal(oldNotice.closed, true);
    oldNotice.emit('action', {}, 1);
    assert.equal(engine.getState().phase, 'recording');
    engine.command('setPermission', { key: 'screen', value: false });
    h.api.toggleCapture();
    assert.equal(engine.getState().phase, 'saving');
  } finally {
    h.dispose();
  }
});

test('onboarding stays open when completion cannot be persisted and malformed UI messages are ignored', async () => {
  const h = await mainHarness({}, (key) => key !== 'onboardingComplete');
  try {
    const panel = h.windows[0];
    h.ui(panel, 'open-onboarding');
    const onboarding = h.windows.find((w) =>
      w.surface === 'onboarding',
    );
    assert(onboarding);
    h.ui(onboarding, 'onboarding-done');
    assert.equal(onboarding.isDestroyed(), false);
    assert.equal(h.api.getPrefs().onboardingComplete, false);
    assert(
      h.messages.some(
        (m) =>
          m.name === 'bloom:state' &&
          m.value.prefError.includes('setup completion'),
      ),
    );
    assert.doesNotThrow(() => h.ui(panel, 'panel-height', { height: NaN }));
    assert.doesNotThrow(() => h.ui(panel, 'open-main', { id: {} }));
    assert.doesNotThrow(() => h.ui(panel, 'set-pref', null));
  } finally {
    h.dispose();
  }
});

test('closing onboarding only cancels capture owned by that onboarding window', async () => {
  const h = await mainHarness();
  try {
    const engine = h.api.getEngine();
    const panel = h.windows[0];
    h.ui(panel, 'open-onboarding');
    let onboarding = h.windows.find((w) => w.surface === 'onboarding');
    h.api.toggleCapture();
    onboarding.close();
    assert.equal(engine.getState().phase, 'starting');
    engine.command('cancel');
    h.ui(panel, 'open-onboarding');
    onboarding = h.windows
      .filter((w) => w.surface === 'onboarding')
      .at(-1);
    h.command(onboarding, 'start');
    onboarding.close();
    assert.equal(engine.getState().phase, 'idle');
    h.ui(panel, 'open-onboarding');
    onboarding = h.windows
      .filter((w) => w.surface === 'onboarding')
      .at(-1);
    h.command(onboarding, 'start');
    engine.command('cancel');
    h.api.toggleCapture();
    onboarding.close();
    assert.equal(engine.getState().phase, 'starting');
  } finally {
    h.dispose();
  }
});

test('versions are immutable engine snapshots and survive closing and reopening the main window', async () => {
  const h = await mainHarness();
  try {
    const engine = h.api.getEngine();
    h.api.openMain('recording/r1');
    const first = h.windows.find((w) => w.surface === 'workspace');
    const value = {
      text: 'Keep this cut',
      cuts: { sil: true, fil: false, cap: true, chap: false },
      trim: 3,
    };
    h.command(first, 'saveVersion', {
      id: 'r1',
      version: { name: '  My review  ', value, kind: 'Edit snapshot' },
    });
    value.text = 'Changed after saving';
    const before = engine
      .getState()
      .recordings.find((r) => r.id === 'r1').versions;
    assert.equal(before[0].name, 'My review');
    assert.equal(before[0].value.text, 'Keep this cut');
    assert.equal(typeof before[0].createdAt, 'number');
    first.close();
    h.api.openMain('recording/r1');
    const second = h.windows.filter((w) => w.surface === 'workspace').at(-1);
    assert.notEqual(first, second);
    assert.deepEqual(
      engine.getState().recordings.find((r) => r.id === 'r1').versions,
      before,
    );
    assert.equal(
      engine.command('saveVersion', {
        id: 'r1',
        version: { name: '', value, kind: 'Edit snapshot' },
      }),
      false,
    );
    assert.equal(
      engine.command('saveVersion', {
        id: 'r1',
        version: {
          name: 'Bad cut',
          value: { ...value, cuts: null },
          kind: 'Edit snapshot',
        },
      }),
      false,
    );
    assert.equal(
      engine.getState().recordings.find((r) => r.id === 'r1').versions.length,
      1,
    );
  } finally {
    h.dispose();
  }
});

test('version recipes store validated configuration without changing the recording status', () => {
  const engine = createSampleEngine();
  try {
    const value = {
      text: 'Original words',
      cuts: { sil: false, fil: false, cap: false, chap: false },
      trim: 0,
    };
    for (const type of [
      'captions',
      'dub',
      'voice',
      'music',
      'vertical',
      'short',
    ]) {
      const recipe = {
        type,
        option: 'Sample choice',
        prompt: 'Retain this configuration',
      };
      assert.equal(
        engine.command('saveVersion', {
          id: 'r1',
          version: { name: type, value, kind: 'Version recipe', recipe },
        }),
        true,
      );
      recipe.prompt = 'Changed after saving';
    }
    const record = engine.getState().recordings.find((r) => r.id === 'r1');
    assert.equal(record.versions.length, 6);
    assert.equal(record.status, 'ready');
    assert(
      record.versions.every(
        (v) => v.recipe.prompt === 'Retain this configuration',
      ),
    );
    for (const recipe of [
      null,
      { type: 'unknown', option: '', prompt: '' },
      { type: 'captions', option: 'x'.repeat(101), prompt: '' },
      { type: 'captions', option: '', prompt: 'x'.repeat(501) },
    ]) {
      assert.equal(
        engine.command('saveVersion', {
          id: 'r1',
          version: { name: 'Invalid', value, kind: 'Version recipe', recipe },
        }),
        false,
      );
    }
    assert.equal(
      engine.command('saveVersion', {
        id: 'r1',
        version: { name: 'Missing recipe', value, kind: 'Version recipe' },
      }),
      false,
    );
    assert.equal(
      engine.getState().recordings.find((r) => r.id === 'r1').versions.length,
      6,
    );
  } finally {
    engine.dispose();
  }
});

test('main navigation can reopen while an earlier native window is still closing', async () => {
  const h = await mainHarness();
  try {
    h.api.openMain('recording/r1');
    const closing = h.windows.find((w) => w.surface === 'workspace');
    closing.emit('close');
    h.api.openMain('recording/r2');
    const replacement = h.windows
      .filter((w) => w.surface === 'workspace')
      .at(-1);
    assert.notEqual(replacement, closing);
    closing.destroyed = true;
    closing.emit('closed');
    h.ui(replacement, 'main-ready');
    assert.equal(
      h.messages.filter((m) => m.name === 'bloom:view').at(-1).value,
      'recording/r2',
    );
    h.api.openMain('settings');
    assert.equal(
      h.messages.filter((m) => m.name === 'bloom:view').at(-1).value,
      'settings',
    );
  } finally {
    h.dispose();
  }
});

test('renaming and deleting versions preserve the original, draft and other versions', () => {
  const engine = createSampleEngine();
  try {
    const value = {
      text: 'Editable cut',
      cuts: { sil: true, fil: false, cap: true, chap: false },
      trim: 2,
    };
    engine.command('saveDraft', { id: 'r1', draft: value });
    const original = structuredClone(
      engine.getState().recordings.find((r) => r.id === 'r1'),
    );
    for (const name of ['First', 'Second'])
      engine.command('saveVersion', {
        id: 'r1',
        version: { name, value, kind: 'Edit snapshot' },
      });
    engine.command('saveVersion', {
      id: 'r2',
      version: { name: 'Other recording', value, kind: 'Edit snapshot' },
    });
    const [first, second] = structuredClone(
      engine.getState().recordings.find((r) => r.id === 'r1').versions,
    );
    const other = structuredClone(
      engine.getState().recordings.find((r) => r.id === 'r2'),
    );
    assert.equal(
      engine.command('renameVersion', {
        id: 'r1',
        versionId: first.id,
        text: '  Renamed  ',
      }),
      true,
    );
    let record = engine.getState().recordings.find((r) => r.id === 'r1');
    assert.deepEqual(record.versions[0], { ...first, name: 'Renamed' });
    assert.deepEqual(record.versions[1], second);
    assert.equal(
      engine.command('renameVersion', {
        id: 'r1',
        versionId: first.id,
        text: ' ',
      }),
      false,
    );
    assert.equal(
      engine.command('renameVersion', {
        id: 'r1',
        versionId: first.id,
        text: 'x'.repeat(101),
      }),
      false,
    );
    assert.equal(
      engine.command('deleteVersion', { id: 'r1', versionId: null }),
      false,
    );
    engine.command('deleteVersion', { id: 'r2', versionId: first.id });
    assert.deepEqual(
      engine.getState().recordings.find((r) => r.id === 'r2'),
      other,
    );
    engine.command('deleteVersion', { id: 'r1', versionId: first.id });
    record = engine.getState().recordings.find((r) => r.id === 'r1');
    assert.deepEqual(record.versions, [second]);
    const { versions, ...unchanged } = record;
    assert.deepEqual(unchanged, original);
    assert.deepEqual(
      engine.getState().recordings.find((r) => r.id === 'r2'),
      other,
    );
  } finally {
    engine.dispose();
  }
});

test('search-cut provenance is a bounded immutable snapshot', () => {
  const engine = createSampleEngine();
  try {
    const value = {
      text: 'Search cut',
      cuts: { sil: false, fil: false, cap: true, chap: false },
      trim: 0,
    };
    const sources = [
      { recordingId: 'r2', at: 42, text: 'Original source moment' },
    ];
    const version = {
      name: 'Search results',
      value,
      kind: 'Search cut',
      sources,
    };
    assert.equal(engine.command('saveVersion', { id: 'r1', version }), true);
    sources[0].text = 'Changed after saving';
    assert.deepEqual(
      engine.getState().recordings.find((r) => r.id === 'r1').versions[0]
        .sources,
      [{ recordingId: 'r2', at: 42, text: 'Original source moment' }],
    );
    for (const bad of [
      null,
      Array(101).fill(sources[0]),
      [{ recordingId: 'r2', at: -1, text: '' }],
      [{ recordingId: 'r2', at: 1.5, text: '' }],
      [{ recordingId: 'r2', at: 0, text: 'x'.repeat(501) }],
      [{ recordingId: '', at: 0, text: '' }],
    ]) {
      assert.equal(
        engine.command('saveVersion', {
          id: 'r1',
          version: { ...version, sources: bad },
        }),
        false,
      );
    }
    assert.equal(
      engine.command('saveVersion', {
        id: 'r1',
        version: { ...version, kind: 'Edit snapshot' },
      }),
      false,
    );
    engine.command('deleteRecording', { id: 'r2' });
    assert.equal(
      engine.getState().recordings.find((r) => r.id === 'r1').versions[0]
        .sources[0].recordingId,
      'r2',
    );
    assert.equal(
      engine.getState().recordings.find((r) => r.id === 'r1').versions.length,
      1,
    );
  } finally {
    engine.dispose();
  }
});
