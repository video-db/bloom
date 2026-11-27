// Recordings that were finalised on this Mac but have not reached VideoDB, for example
// after quitting during an upload. They outlive capture sessions: starting a new
// recording never clears them, and nothing is deleted locally until VideoDB has it.
function createUploads(ctx) {
  const { get, set, recordings, inBackground } = ctx;
  let pending = []; // { id, title, duration, progress, status: waiting | uploading | failed }
  let serial = 0;

  const view = () => ({ pending });
  const find = (id) => pending.find((upload) => upload.id === id);
  const change = (id, patch) => {
    pending = pending.map((upload) =>
      upload.id === id ? { ...upload, ...patch } : upload,
    );
    set(view());
  };

  function arrive(upload) {
    pending = pending.filter((item) => item.id !== upload.id);
    recordings.add({
      id: upload.id,
      title: upload.title,
      duration: upload.duration,
      trim: 0,
      status: 'processing',
      createdAt: Date.now(),
      meta: `Today · ${Math.floor(upload.duration / 60)}:${String(upload.duration % 60).padStart(2, '0')}`,
      transcript: 'This recording was uploaded after Bloom was reopened.',
      marks: [],
      silence: 0,
      filler: 0,
      chips: [],
    });
    set({ ...view(), ...recordings.view() });
    inBackground(1200, () => {
      recordings.settle(upload.id, (r) => ({ ...r, status: 'ready' }));
      set(recordings.view());
    });
  }

  const commands = {
    resumeUpload({ id }) {
      const upload = find(id);
      if (!upload || upload.status === 'uploading') return;
      change(id, { status: 'uploading' });
      const steps = 3;
      const from = upload.progress;
      for (let step = 1; step <= steps; step++)
        inBackground(step * 300, () => {
          if (find(id)?.status !== 'uploading') return;
          if (step < steps)
            return change(id, {
              progress: from + ((1 - from) * step) / steps,
            });
          arrive(find(id));
        });
    },
    // Gives up on a recording that never reached VideoDB. The window confirms first.
    discardUpload({ id }) {
      if (!find(id) || find(id).status === 'uploading') return;
      pending = pending.filter((upload) => upload.id !== id);
      set(view());
    },
  };

  return {
    commands,
    view,
    // Preview-only: a recording left behind by an earlier session.
    simulate(kind) {
      if (kind !== 'pending-upload' || get().phase !== 'idle' || pending.length)
        return;
      pending = [
        {
          id: `upload-${++serial}`,
          title: 'Weekly product sync',
          duration: 1930,
          progress: 0.4,
          status: 'waiting',
        },
      ];
      set(view());
    },
  };
}

module.exports = { createUploads };
