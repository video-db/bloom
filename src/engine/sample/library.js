// Library commands: what a person does to a saved recording. Rename, delete and undo,
// retry failed processing, and save an editor draft.
function createLibrary(ctx) {
  const { get, set, recordings, inBackground } = ctx;

  const commands = {
    // Renames the recording that has just finished (state.result); renameRecording takes any id.
    rename({ text }) {
      if (!get().result || !text.trim()) return;
      const title = text.trim();
      recordings.edit(get().result.id, (r) => ({ ...r, title }));
      set({
        ...recordings.view(),
        result: { ...get().result, title, renamed: true },
      });
    },
    renameRecording({ id, text }) {
      if (typeof text !== 'string' || !text.trim()) return;
      const title = text.trim().slice(0, 180);
      recordings.edit(id, (r) => ({ ...r, title }));
      set({
        ...recordings.view(),
        ...(get().result?.id === id
          ? { result: { ...get().result, title } }
          : {}),
      });
    },
    deleteRecording({ id }) {
      if (!recordings.remove(id)) return;
      set({
        ...recordings.view(),
        ...(get().result?.id === id ? { result: null, phase: 'idle' } : {}),
      });
    },
    restoreRecording() {
      if (!recordings.restore()) return;
      set(recordings.view());
    },
    saveDraft({ id, draft }) {
      if (
        !draft ||
        typeof draft.text !== 'string' ||
        typeof draft.cuts !== 'object'
      )
        return;
      recordings.edit(id, (r) => ({
        ...r,
        draft: {
          text: draft.text,
          cuts: {
            sil: !!draft.cuts.sil,
            fil: !!draft.cuts.fil,
            cap: !!draft.cuts.cap,
            chap: !!draft.cuts.chap,
          },
          trim: Number(draft.trim) || 0,
        },
        editedAt: Date.now(),
      }));
      set(recordings.view());
    },
    retryRecording({ id }) {
      if (!recordings.all().some((r) => r.id === id && r.status === 'error'))
        return;
      recordings.edit(id, (r) => ({ ...r, status: 'processing' }));
      set({ recordings: recordings.all() });
      inBackground(1800, () => {
        recordings.settle(id, (r) => ({ ...r, status: 'ready' }));
        set(recordings.view());
      });
    },
  };

  return { commands };
}

module.exports = { createLibrary };
