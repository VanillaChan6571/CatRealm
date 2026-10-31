import { create } from 'zustand';

/**
 * Cat Lab — reactive avatars for the OBS voice overlay.
 *
 * Each person in a call can be given per-state art (idle / speaking / muted /
 * deafened) plus a motion style, shown in the overlay instead of their profile
 * avatar. This store holds the local overrides; the image bytes live in the
 * Electron main process (content-addressed, see electron/reactiveAvatarFiles.cjs)
 * and are referenced here by id. Nothing here leaves this device.
 */
export const REACTIVE_AVATAR_STATES = ['idle', 'speaking', 'muted', 'deafened'] as const;
export type ReactiveAvatarState = (typeof REACTIVE_AVATAR_STATES)[number];

export const REACTIVE_AVATAR_MOTIONS = ['none', 'bounce', 'pop'] as const;
export type ReactiveAvatarMotion = (typeof REACTIVE_AVATAR_MOTIONS)[number];

export type ReactiveAvatarOverride = {
  /** Person key from getOverlayPersonKey(): `central:<id>` or `server:<origin>:<id>`. */
  key: string;
  /** Display name when last edited, so saved overrides stay recognisable out of a call. */
  label: string;
  images: Partial<Record<ReactiveAvatarState, string>>;
  motion: ReactiveAvatarMotion;
  updatedAt: number;
};

/** Your own pack: shown for you in your overlay, and what friends will receive. */
export type ReactiveAvatarPack = {
  images: Partial<Record<ReactiveAvatarState, string>>;
  motion: ReactiveAvatarMotion;
  updatedAt: number;
  /**
   * Smaller copies sent to friends instead of large originals (original id ->
   * copy id). Your own overlay always uses the originals.
   */
  shareCopies: Record<string, string>;
};

type ReactiveAvatarStoreState = {
  overrides: Record<string, ReactiveAvatarOverride>;
  myPack: ReactiveAvatarPack;
  setMyImage: (state: ReactiveAvatarState, imageId: string) => void;
  clearMyImage: (state: ReactiveAvatarState) => void;
  setMyMotion: (motion: ReactiveAvatarMotion) => void;
  setMyShareCopy: (originalId: string, copyId: string) => void;
  setImage: (key: string, label: string, state: ReactiveAvatarState, imageId: string) => void;
  clearImage: (key: string, state: ReactiveAvatarState) => void;
  setMotion: (key: string, label: string, motion: ReactiveAvatarMotion) => void;
  removeOverride: (key: string) => void;
};

const STORAGE_KEY = 'catrealm.reactiveAvatars';
const MY_PACK_STORAGE_KEY = 'catrealm.reactiveAvatars.myPack';
const IMAGE_ID_PATTERN = /^[0-9a-f]{64}\.(png|gif|webp|webm)$/;

function isState(value: string): value is ReactiveAvatarState {
  return (REACTIVE_AVATAR_STATES as readonly string[]).includes(value);
}

function isMotion(value: unknown): value is ReactiveAvatarMotion {
  return typeof value === 'string' && (REACTIVE_AVATAR_MOTIONS as readonly string[]).includes(value);
}

function parseImages(value: unknown): Partial<Record<ReactiveAvatarState, string>> {
  const images: Partial<Record<ReactiveAvatarState, string>> = {};
  if (!value || typeof value !== 'object') return images;
  for (const [state, id] of Object.entries(value)) {
    if (isState(state) && typeof id === 'string' && IMAGE_ID_PATTERN.test(id)) images[state] = id;
  }
  return images;
}

/** Drops share copies whose original is no longer part of the pack. */
function withLiveCopies(images: Partial<Record<ReactiveAvatarState, string>>, copies: Record<string, string>) {
  const live = new Set(Object.values(images));
  return Object.fromEntries(Object.entries(copies).filter(([original]) => live.has(original)));
}

function loadMyPack(): ReactiveAvatarPack {
  const empty: ReactiveAvatarPack = { images: {}, motion: 'bounce', updatedAt: 0, shareCopies: {} };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(MY_PACK_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ReactiveAvatarPack>) : null;
    if (!parsed || typeof parsed !== 'object') return empty;
    const images = parseImages(parsed.images);
    const shareCopies: Record<string, string> = {};
    for (const [original, copy] of Object.entries(parsed.shareCopies ?? {})) {
      if (IMAGE_ID_PATTERN.test(original) && typeof copy === 'string' && IMAGE_ID_PATTERN.test(copy)) shareCopies[original] = copy;
    }
    return {
      images,
      motion: isMotion(parsed.motion) ? parsed.motion : 'bounce',
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      shareCopies: withLiveCopies(images, shareCopies),
    };
  } catch {
    return empty;
  }
}

function loadOverrides(): Record<string, ReactiveAvatarOverride> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, ReactiveAvatarOverride> = {};
    for (const entry of Object.values(parsed as Record<string, Partial<ReactiveAvatarOverride>>)) {
      if (!entry || typeof entry.key !== 'string') continue;
      result[entry.key] = {
        key: entry.key,
        label: typeof entry.label === 'string' ? entry.label : entry.key,
        images: parseImages(entry.images),
        motion: isMotion(entry.motion) ? entry.motion : 'bounce',
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/** Image ids still referenced by any override or your pack; everything else on disk can go. */
export function getReferencedReactiveImageIds(
  overrides: Record<string, ReactiveAvatarOverride>,
  myPack?: ReactiveAvatarPack,
): string[] {
  const ids = new Set<string>();
  for (const images of [...Object.values(overrides).map((o) => o.images), myPack?.images ?? {}, myPack?.shareCopies ?? {}]) {
    for (const id of Object.values(images)) if (id) ids.add(id);
  }
  return [...ids];
}

function persist(overrides: Record<string, ReactiveAvatarOverride>, myPack: ReactiveAvatarPack) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    window.localStorage.setItem(MY_PACK_STORAGE_KEY, JSON.stringify(myPack));
  } catch {
    // Ignore quota/serialization failures; overrides still apply for the session.
  }
  // Unreferenced image files are cleaned up by lib/reactiveAvatarShare/imageGc,
  // which also accounts for packs received from other people.
}

function upsert(
  overrides: Record<string, ReactiveAvatarOverride>,
  key: string,
  label: string,
  change: (current: ReactiveAvatarOverride) => ReactiveAvatarOverride,
) {
  const current = overrides[key] ?? { key, label, images: {}, motion: 'bounce' as const, updatedAt: 0 };
  return { ...overrides, [key]: { ...change(current), label: label || current.label, updatedAt: Date.now() } };
}

export const useReactiveAvatarStore = create<ReactiveAvatarStoreState>((set, get) => ({
  overrides: loadOverrides(),
  myPack: loadMyPack(),
  setMyImage: (state, imageId) => {
    const images = { ...get().myPack.images, [state]: imageId };
    const myPack = { ...get().myPack, images, shareCopies: withLiveCopies(images, get().myPack.shareCopies), updatedAt: Date.now() };
    set({ myPack });
    persist(get().overrides, myPack);
  },
  clearMyImage: (state) => {
    const images = { ...get().myPack.images };
    delete images[state];
    const myPack = { ...get().myPack, images, shareCopies: withLiveCopies(images, get().myPack.shareCopies), updatedAt: Date.now() };
    set({ myPack });
    persist(get().overrides, myPack);
  },
  setMyShareCopy: (originalId, copyId) => {
    const myPack = { ...get().myPack, shareCopies: { ...get().myPack.shareCopies, [originalId]: copyId }, updatedAt: Date.now() };
    set({ myPack });
    persist(get().overrides, myPack);
  },
  setMyMotion: (motion) => {
    const myPack = { ...get().myPack, motion, updatedAt: Date.now() };
    set({ myPack });
    persist(get().overrides, myPack);
  },
  setImage: (key, label, state, imageId) => {
    const overrides = upsert(get().overrides, key, label, (o) => ({ ...o, images: { ...o.images, [state]: imageId } }));
    set({ overrides });
    persist(overrides, get().myPack);
  },
  clearImage: (key, state) => {
    const current = get().overrides[key];
    if (!current) return;
    const images = { ...current.images };
    delete images[state];
    const overrides = { ...get().overrides };
    if (Object.keys(images).length === 0) delete overrides[key];
    else overrides[key] = { ...current, images, updatedAt: Date.now() };
    set({ overrides });
    persist(overrides, get().myPack);
  },
  setMotion: (key, label, motion) => {
    const overrides = upsert(get().overrides, key, label, (o) => ({ ...o, motion }));
    set({ overrides });
    persist(overrides, get().myPack);
  },
  removeOverride: (key) => {
    const overrides = { ...get().overrides };
    delete overrides[key];
    set({ overrides });
    persist(overrides, get().myPack);
  },
}));
