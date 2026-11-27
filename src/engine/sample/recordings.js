// The recordings store: the list every window shows and the one deleted recording that
// Undo can still bring back. Capture, library and versions all change recordings through
// it, so there is exactly one copy.
function createRecordings(seed) {
  let list = structuredClone(seed);
  let deleted = null;

  const recent = () => list.slice(0, 3);
  const edit = (id, change) => {
    list = list.map((r) => (r.id === id ? change(r) : r));
  };

  return {
    all: () => list,
    recent,
    // The two state fields that have to be published together after the list changes.
    view: () => ({ recordings: list, recent: recent() }),
    add(recording) {
      list = [recording, ...list];
    },
    // A person's change to a listed recording.
    edit,
    // The outcome of a background job.
    settle(id, change) {
      edit(id, change);
      // Deleted records remain eligible for background job updates until Undo expires.
      if (deleted?.id === id) deleted = change(deleted);
    },
    // Removes for good: a discarded recording cannot be restored.
    discard(id) {
      list = list.filter((r) => r.id !== id);
    },
    // Removes but keeps the record for restore(). Returns whether anything was removed.
    remove(id) {
      deleted = list.find((r) => r.id === id);
      if (!deleted) return false;
      list = list.filter((r) => r.id !== id);
      return true;
    },
    restore() {
      if (!deleted) return false;
      list = [deleted, ...list];
      deleted = null;
      return true;
    },
  };
}

module.exports = { createRecordings };
