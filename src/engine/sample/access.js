// Whether Bloom can reach VideoDB and who is signed in. A key is checked and then
// dropped: it never enters the state that windows read. Timers stand in for VideoDB.
function createAccess(ctx, { signedIn }) {
  const { get, set, inBackground } = ctx;
  // Outlives capture sessions, so it is kept here and republished by view().
  let status = signedIn ? 'signed-in' : 'signed-out'; // signed-out | checking | signed-in | invalid | offline
  let online = true;

  const view = () => ({
    account: {
      status,
      label: status === 'signed-in' ? 'Sample account' : '',
    },
    online,
  });
  const publish = (extra = {}) => set({ ...view(), ...extra });
  const betweenSessions = () => ['idle', 'finished'].includes(get().phase);

  // Sample rules standing in for VideoDB's answer to a key.
  const check = (key) =>
    key.includes('offline')
      ? 'offline'
      : key.trim().length < 16 || key.includes('invalid')
        ? 'invalid'
        : 'signed-in';

  const commands = {
    signIn({ key }) {
      if (status === 'checking' || status === 'signed-in') return;
      status = 'checking';
      publish();
      inBackground(700, () => {
        if (status !== 'checking') return;
        status = check(key);
        publish();
      });
    },
    signOut() {
      if (status !== 'signed-in' || !betweenSessions()) return;
      status = 'signed-out';
      publish();
    },
    checkConnection() {
      online = true;
      publish(get().problem?.kind === 'offline' ? { problem: null } : {});
    },
  };

  return {
    commands,
    view,
    signedIn: () => status === 'signed-in',
    online: () => online,
    // Preview-only: reach the offline state by hand.
    simulate(kind) {
      if (kind !== 'offline' || get().phase !== 'idle') return;
      online = false;
      publish({ problem: { kind: 'offline' } });
    },
  };
}

module.exports = { createAccess };
