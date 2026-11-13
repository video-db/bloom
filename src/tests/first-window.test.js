// What opens at launch: setup on first run, the tray panel for a returning person, and
// never a decision made while the saved key is still being checked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openFirstWindow } = require('../main/first-window');

function world({ onboardingComplete, flags = [], sample = false }) {
  const opened = [];
  let finishCheck;
  const engine = {
    ready: new Promise((resolve) => {
      finishCheck = resolve;
    }),
    getState: () => ({ sample }),
    command: (name, args) => opened.push(`command:${name}:${args.key}`),
  };
  const windows = {
    showPanel: () => opened.push('panel'),
    openOnboarding: () => opened.push('onboarding'),
    openMain: (view) => opened.push(`main:${view}`),
  };
  const run = openFirstWindow({
    engine,
    windows,
    prefs: { all: () => ({ onboardingComplete }) },
    flag: (name) => flags.includes(name),
  });
  return { opened, finishCheck, run };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a returning person sees nothing until the saved key is checked, then the panel', async () => {
  const w = world({ onboardingComplete: true });
  await settle();
  assert.deepEqual(w.opened, [], 'no window while the key is being checked');
  w.finishCheck();
  await w.run;
  assert.deepEqual(w.opened, ['panel']);
});

test('first run opens setup straight away', async () => {
  const w = world({ onboardingComplete: false });
  await w.run;
  assert.deepEqual(w.opened, ['onboarding']);
});

test('the sample engine starts first run without permissions, and flags open the main window', async () => {
  const first = world({ onboardingComplete: false, sample: true });
  await first.run;
  assert.deepEqual(first.opened, [
    'command:setPermission:screen',
    'command:setPermission:mic',
    'onboarding',
  ]);
  const skipping = world({
    onboardingComplete: false,
    flags: ['skip-onboarding', 'open-main'],
  });
  skipping.finishCheck();
  await skipping.run;
  assert.deepEqual(skipping.opened, ['panel', 'main:library']);
});
