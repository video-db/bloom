// Every notification and reminder: sent only when Bloom is out of sight, always with the next action.
const { Notification } = require('electron');
const { clock } = require('./clock');

// The display being recorded, by name. The real engine keeps its id; the sample keeps a name.
const screenName = (state) =>
  state.channels?.displays?.find((d) => d.id === state.sources.screen)?.name ||
  (state.sample && state.sources.screen) ||
  'Your screen';

function createNotifications({ engine, prefs, windows }) {
  const sessionNotifications = new Map();
  let nudged = false,
    pausedAt = null,
    pauseNotified = false,
    resultNotification = null,
    resultStage = null,
    lastPhase = null,
    lastAsk = null;

  let permissionNotice = null;
  function notify({ title, body, actions = [], onAction, onClick, sticky }) {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title,
      body,
      silent: true,
      timeoutType: sticky ? 'never' : 'default',
      actions: actions.map((text) => ({ type: 'button', text })),
    });
    n.on('action', (_e, index) => onAction && onAction(index));
    n.on('click', () => (onClick ? onClick() : windows.showPanel()));
    n.show();
    return n;
  }

  // Notifications are retired with their capture session, even if macOS retains a banner.
  function sessionNotify(key, state, condition, options) {
    const sessionId = state.sessionId;
    if (!sessionId) return;
    sessionNotifications.get(key)?.notification?.close();
    const active = () => {
      const now = engine.getState();
      return now.sessionId === sessionId && condition(now);
    };
    const notification = notify({
      ...options,
      onAction: (index) => {
        if (active()) options.onAction?.(index);
      },
      onClick: () => {
        if (active()) (options.onClick || windows.showPanel)();
      },
    });
    sessionNotifications.set(key, { notification, sessionId, condition });
  }

  function retireNotifications(state) {
    for (const [key, item] of sessionNotifications) {
      if (item.sessionId !== state.sessionId || !item.condition(state)) {
        item.notification?.close();
        sessionNotifications.delete(key);
      }
    }
  }

  function openResult(id) {
    if (engine.getState().recordings.some((r) => r.id === id))
      windows.openMain(`recording/${id}`);
  }

  function react(state) {
    retireNotifications(state);
    if (
      state.phase === 'finished' &&
      state.result &&
      `${state.result.id}:${state.result.stage}` !== resultStage
    ) {
      const ready = state.result.stage === 2;
      if (state.result.stage === 0 || ready) {
        resultNotification?.close();
        resultNotification = null;
        if (windows.outOfSight() && prefs.all().notifyLinkReady)
          resultNotification = notify({
            title: !state.sample
              ? 'Recording ready to play'
              : ready
                ? 'Ready to edit'
                : 'Link ready (sample)',
            body: state.result.title,
            actions: ['Open recording'],
            onAction: () => openResult(state.result.id),
            onClick: () => openResult(state.result.id),
          });
      }
      resultStage = `${state.result.id}:${state.result.stage}`;
    }
    if (state.phase !== 'finished') {
      resultStage = null;
      resultNotification?.close();
      resultNotification = null;
    }
    if (
      state.phase !== lastPhase &&
      state.phase === 'stopped' &&
      windows.outOfSight()
    )
      sessionNotify(
        'stopped',
        state,
        (s) => s.phase === 'stopped',
        state.sample
          ? {
              title: 'Recording stopped (sample)',
              body: `Connection lost at ${clock(state.problem.at)}. Review recovery options.`,
              actions: ['Try again', 'Keep recording so far'],
              sticky: true,
              onAction: (i) => engine.command(i === 0 ? 'retry' : 'keep'),
            }
          : {
              title: 'Recording needs attention',
              body: 'Bloom couldn’t confirm the recording stopped. It may still be capturing.',
              actions: ['Review'],
              sticky: true,
              onAction: windows.showPanel,
            },
      );
    if (
      state.ask &&
      state.ask !== lastAsk &&
      windows.outOfSight() &&
      prefs.all().notifyMeetingEnded
    )
      sessionNotify(
        'meeting',
        state,
        (s) => s.phase === 'recording' && !!s.ask,
        {
          title: 'Meeting ended?',
          body: `Still recording ${screenName(state)} · ${clock(state.elapsed)}`,
          actions: ['Review', 'Keep recording'],
          sticky: true,
          onAction: (i) =>
            i === 0
              ? windows.showPanel()
              : engine.command('answerAsk', { stop: false }),
        },
      );
    if (state.phase === 'paused') {
      if (pausedAt === null) pausedAt = Date.now();
    } else {
      pausedAt = null;
      pauseNotified = false;
    }
  }

  function nudge(state) {
    if (state.phase === 'idle' || state.phase === 'starting') nudged = false;
    const minutes = prefs.all().nudgeMinutes;
    if (
      state.phase !== 'recording' ||
      !minutes ||
      nudged ||
      state.elapsed < minutes * 60 ||
      !windows.outOfSight()
    )
      return;
    nudged = true;
    sessionNotify('long-recording', state, (s) => s.phase === 'recording', {
      title: `Still recording · ${clock(state.elapsed)}`,
      body: `${screenName(state)} is being captured.`,
      actions: ['Keep going', 'Stop'],
      onAction: (i) => i === 1 && engine.command('stop'),
    });
  }

  // Polled: a reminder can fall due with no engine change, as time passes or Bloom goes out of sight.
  const reminderTimer = setInterval(() => {
    nudge(engine.getState());
    if (
      pausedAt !== null &&
      !pauseNotified &&
      Date.now() - pausedAt >= 5 * 60000 &&
      windows.outOfSight()
    ) {
      pauseNotified = true;
      sessionNotify('paused', engine.getState(), (s) => s.phase === 'paused', {
        title: 'Still paused',
        body: 'Nothing is being captured.',
        actions: ['Resume', 'Stop'],
        sticky: true,
        onAction: (i) => engine.command(i === 0 ? 'resume' : 'stop'),
      });
    }
  }, 1000);

  return {
    // Called with every engine state change.
    observe(state) {
      react(state);
      nudge(state);
      lastPhase = state.phase;
      lastAsk = state.ask;
    },
    screenPermissionNeeded() {
      // Held on to: a notification nothing refers to can be cleared away with its buttons.
      permissionNotice = notify({
        title: 'Bloom can’t see your screen',
        body: 'Turn on Screen Recording for Bloom to record.',
        actions: ['Review'],
        onAction: windows.showPanel,
      });
    },
    dispose() {
      clearInterval(reminderTimer);
      for (const item of sessionNotifications.values())
        item.notification?.close();
      resultNotification?.close();
    },
  };
}

module.exports = { createNotifications };
