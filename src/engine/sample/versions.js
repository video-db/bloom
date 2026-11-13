// Versions of a recording: saved edit snapshots, search cuts and version recipes.
// A version is copied when it is saved, so later changes by the sender cannot alter it.
function createVersions(ctx) {
  const { set, recordings } = ctx;
  let serial = 0;

  const hasVersion = (id, versionId) =>
    recordings
      .all()
      .some((r) => r.id === id && r.versions?.some((v) => v.id === versionId));

  const commands = {
    saveVersion({ id, version }) {
      if (!recordings.all().some((r) => r.id === id)) return;
      const createdAt = Date.now();
      const saved = {
        id: `version-${++serial}`,
        name: version.name.trim(),
        value: structuredClone(version.value),
        kind: version.kind,
        ...(version.recipe ? { recipe: structuredClone(version.recipe) } : {}),
        ...(version.sources
          ? { sources: structuredClone(version.sources) }
          : {}),
        createdAt,
        time: new Date(createdAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      recordings.edit(id, (r) => ({
        ...r,
        versions: [...(r.versions || []), saved],
      }));
      set(recordings.view());
    },
    renameVersion({ id, versionId, text }) {
      if (!hasVersion(id, versionId)) return;
      recordings.edit(id, (r) => ({
        ...r,
        versions: r.versions.map((v) =>
          v.id === versionId ? { ...v, name: text.trim() } : v,
        ),
      }));
      set(recordings.view());
    },
    deleteVersion({ id, versionId }) {
      if (!hasVersion(id, versionId)) return;
      recordings.edit(id, (r) => ({
        ...r,
        versions: r.versions.filter((v) => v.id !== versionId),
      }));
      set(recordings.view());
    },
  };

  return { commands };
}

module.exports = { createVersions };
