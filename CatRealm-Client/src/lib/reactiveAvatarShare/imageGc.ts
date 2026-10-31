import { getReferencedReactiveImageIds, useReactiveAvatarStore } from '../../stores/reactiveAvatarStore';
import { useReactiveShareStore } from '../../stores/reactiveShareStore';

/**
 * Deletes stored reactive avatar images nothing references any more: your own
 * art, per-person overrides and received packs together. Debounced, since an
 * edit or a received pack often changes several references at once.
 */
const PRUNE_DELAY_MS = 2000;
let initialized = false;
let timer: number | null = null;

function schedulePrune() {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    const { overrides, myPack } = useReactiveAvatarStore.getState();
    const ids = new Set(getReferencedReactiveImageIds(overrides, myPack));
    for (const pack of Object.values(useReactiveShareStore.getState().received)) {
      for (const id of Object.values(pack.images)) if (id) ids.add(id);
    }
    void window.electron?.reactiveAvatarPrune?.([...ids]).catch(() => {});
  }, PRUNE_DELAY_MS);
}

export function initReactiveImageGc() {
  if (initialized || typeof window === 'undefined' || !window.electron?.reactiveAvatarPrune) return;
  initialized = true;
  useReactiveAvatarStore.subscribe((state, prev) => {
    if (state.overrides !== prev.overrides || state.myPack !== prev.myPack) schedulePrune();
  });
  useReactiveShareStore.subscribe((state, prev) => {
    if (state.received !== prev.received) schedulePrune();
  });
}
