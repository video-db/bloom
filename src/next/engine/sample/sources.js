// What a session captures and whether it is allowed to: the saved source defaults, the
// sources chosen by hand for the next session, and the screen, microphone and camera
// permissions.
function createSources(ctx) {
  const { get, set } = ctx;
  let defaults = { mic: true, systemAudio: false, camera: false };
  let permissions = { screen: true, mic: true, camera: true };
  // Sources chosen by hand; a later change of defaults or permissions must not undo them.
  const overrides = new Set();

  // The sources a new session starts with.
  const fresh = () => ({
    screen: 'Display 1',
    ...defaults,
    mic: defaults.mic && permissions.mic,
    camera: defaults.camera && permissions.camera,
  });

  const permit = (key, value) => {
    permissions = { ...permissions, [key]: value };
    return permissions;
  };

  const commands = {
    setSource({ key, value }) {
      if (
        get().phase !== 'idle' ||
        (value && Object.hasOwn(permissions, key) && !permissions[key])
      )
        return;
      overrides.add(key);
      set({ sources: { ...get().sources, [key]: value } });
    },
    checkPermission() {
      set({ permissions: permit('screen', true), problem: null });
    },
    setPermission({ key, value }) {
      if (!(key in permissions)) return;
      set({
        permissions: permit(key, !!value),
        sources: {
          ...get().sources,
          ...(key !== 'screen'
            ? {
                [key]:
                  !!value &&
                  (overrides.has(key) ? get().sources[key] : defaults[key]),
              }
            : {}),
        },
      });
    },
    configure({ sources }) {
      const changed = Object.keys(sources).filter(
        (k) => defaults[k] !== sources[k],
      );
      if (!changed.length) return;
      defaults = { ...defaults, ...sources };
      if (get().phase === 'idle') {
        const patch = Object.fromEntries(
          changed
            .filter((k) => !overrides.has(k))
            .map((k) => [k, defaults[k] && permissions[k] !== false]),
        );
        if (Object.keys(patch).length)
          set({ sources: { ...get().sources, ...patch } });
      }
    },
  };

  return {
    commands,
    fresh,
    permissions: () => permissions,
    permit,
    forgetChoices: () => overrides.clear(),
  };
}

module.exports = { createSources };
