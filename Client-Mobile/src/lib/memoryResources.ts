// Scalars only: diagnostics must never retain players, views, or sample history.
type Resource = 'particleViews' | 'activeParticles' | 'notificationOneShots' | 'notificationLoops';
const counts: Record<Resource, number> = {
  particleViews: 0, activeParticles: 0, notificationOneShots: 0, notificationLoops: 0,
};
const noopLease = { setCount: (_count: number) => {}, dispose: () => {} };

export function trackMemoryResource(resource: Resource, initialCount = 1) {
  if (!__DEV__) return noopLease;
  let count = initialCount;
  let disposed = false;
  counts[resource] += count;
  return {
    setCount(next: number) {
      if (disposed) return;
      counts[resource] += next - count;
      count = next;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      counts[resource] -= count;
    },
  };
}

export function getMemoryResourceCounts() {
  return { ...counts };
}
