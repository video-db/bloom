// Notifications from the real engine: real wording, the display by name, and no action the
// real engine cannot carry out.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const shown = [];
class FakeNotification {
  static isSupported() {
    return true;
  }
  constructor(options) {
    this.options = options;
    this.handlers = {};
  }
  on(name, handler) {
    this.handlers[name] = handler;
  }
  show() {
    shown.push(this);
  }
  close() {}
}

const load = Module._load;
Module._load = (request, ...rest) =>
  request === 'electron'
    ? { Notification: FakeNotification }
    : load(request, ...rest);
const { createNotifications } = require('../main/notifications');
Module._load = load;

function setup(state) {
  shown.length = 0;
  const calls = [];
  const engine = {
    getState: () => state,
    command: (name) => calls.push(name),
  };
  const windows = {
    outOfSight: () => true,
    showPanel: () => calls.push('showPanel'),
    openMain: () => {},
  };
  const prefs = { all: () => ({ nudgeMinutes: 45, notifyLinkReady: true }) };
  const notifications = createNotifications({ engine, prefs, windows });
  return { notifications, calls };
}

const real = (extra) => ({
  sample: false,
  sessionId: 's1',
  phase: 'recording',
  elapsed: 0,
  sources: { screen: 'display:2' },
  channels: { displays: [{ id: 'display:2', name: 'Studio Display' }] },
  recordings: [],
  ...extra,
});

test('an unconfirmed stop asks for a review and offers nothing the engine lacks', () => {
  const state = real({ phase: 'stopped', problem: { kind: 'stop-failed' } });
  const { notifications, calls } = setup(state);
  notifications.observe(state);
  const [notice] = shown;
  assert.equal(notice.options.title, 'Recording needs attention');
  assert.doesNotMatch(notice.options.body, /sample|NaN|Connection lost/);
  assert.deepEqual(
    notice.options.actions.map((a) => a.text),
    ['Review'],
  );
  notice.handlers.action({}, 0);
  assert.deepEqual(calls, ['showPanel']);
  notifications.dispose();
});

test('the long-recording reminder names the display, not its id', () => {
  const state = real({ elapsed: 45 * 60 });
  const { notifications } = setup(state);
  notifications.observe(state);
  const [notice] = shown;
  assert.match(notice.options.title, /^Still recording · 45:00/);
  assert.equal(notice.options.body, 'Studio Display is being captured.');
  notifications.dispose();
});

test('missing screen permission is said plainly', () => {
  const { notifications } = setup(real());
  notifications.screenPermissionNeeded();
  assert.equal(shown[0].options.title, 'Bloom can’t see your screen');
  assert.doesNotMatch(shown[0].options.body, /preview|simulat/);
  notifications.dispose();
});
