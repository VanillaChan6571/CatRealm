/** Serializes native audio ownership; a late start must not outlive its last owner. */
export function createAudioSessionManager(start: () => Promise<void>, stop: () => Promise<void>) {
  let owners = 0;
  let started = false;
  let pending = Promise.resolve();
  const reconcile = () => {
    const next = pending.then(async () => {
      if (owners > 0 && !started) {
        await start();
        started = true;
      }
      if (owners === 0 && started) {
        await stop();
        started = false;
      }
    });
    pending = next.catch(() => {});
    return next;
  };
  return {
    acquire: () => { owners += 1; return reconcile(); },
    release: () => { owners = Math.max(0, owners - 1); return reconcile(); },
  };
}
