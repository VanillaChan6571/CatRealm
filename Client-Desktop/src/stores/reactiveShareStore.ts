import { create } from 'zustand';
import type { ReactiveAvatarMotion, ReactiveAvatarState } from './reactiveAvatarStore';

/**
 * Cat Lab — sharing reactive avatar packs in calls.
 *
 * Persisted: who you share with, packs you've received (cached by hash so a
 * friend's pack only crosses the network once), and your allow / block choice
 * per person. Live (this call only): which participant offers which pack.
 */
export type ReactiveShareMode = 'off' | 'friends' | 'everyone';
export type ReactiveApproval = 'allowed' | 'blocked';

export type ReceivedReactivePack = {
  motion: ReactiveAvatarMotion;
  images: Partial<Record<ReactiveAvatarState, string>>;
  receivedAt: number;
};

/** A pack someone in the current call offers us. */
export type OfferedReactivePack = {
  identity: string;
  hash: string;
  /** friend = verified with your shared DM key; public = anyone-in-call tier. */
  kind: 'friend' | 'public';
  centralId: string | null;
  status: 'available' | 'downloading' | 'ready' | 'failed';
};

type ReactiveShareState = {
  shareMode: ReactiveShareMode;
  received: Record<string, ReceivedReactivePack>;
  approvals: Record<string, ReactiveApproval>;
  offered: Record<string, OfferedReactivePack>;
  setShareMode: (mode: ReactiveShareMode) => void;
  setApproval: (approvalKey: string, approval: ReactiveApproval | null) => void;
  addReceived: (hash: string, pack: ReceivedReactivePack) => void;
  setOffered: (personKey: string, offer: OfferedReactivePack | null) => void;
  clearOffered: () => void;
};

const STORAGE_KEY = 'catrealm.reactiveShare';
/** Received packs kept on disk; the least recently received are evicted first. */
const MAX_RECEIVED_PACKS = 40;

type Persisted = Pick<ReactiveShareState, 'shareMode' | 'received' | 'approvals'>;

function load(): Persisted {
  const fallback: Persisted = { shareMode: 'friends', received: {}, approvals: {} };
  if (typeof window === 'undefined') return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Persisted> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;
    const shareMode = parsed.shareMode === 'off' || parsed.shareMode === 'everyone' ? parsed.shareMode : 'friends';
    const approvals: Record<string, ReactiveApproval> = {};
    for (const [key, value] of Object.entries(parsed.approvals ?? {})) {
      if (value === 'allowed' || value === 'blocked') approvals[key] = value;
    }
    const received: Record<string, ReceivedReactivePack> = {};
    for (const [hash, pack] of Object.entries(parsed.received ?? {})) {
      if (/^[0-9a-f]{64}$/.test(hash) && pack && typeof pack === 'object' && pack.images) received[hash] = pack;
    }
    return { shareMode, received, approvals };
  } catch {
    return fallback;
  }
}

function persist(state: Persisted) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      shareMode: state.shareMode,
      received: state.received,
      approvals: state.approvals,
    }));
  } catch {
    // Ignore quota failures; sharing still works for this session.
  }
}

export const useReactiveShareStore = create<ReactiveShareState>((set, get) => ({
  ...load(),
  offered: {},
  setShareMode: (shareMode) => {
    set({ shareMode });
    persist(get());
  },
  setApproval: (approvalKey, approval) => {
    const approvals = { ...get().approvals };
    if (approval) approvals[approvalKey] = approval;
    else delete approvals[approvalKey];
    set({ approvals });
    persist(get());
  },
  addReceived: (hash, pack) => {
    const entries = Object.entries({ ...get().received, [hash]: pack })
      .sort((a, b) => b[1].receivedAt - a[1].receivedAt)
      .slice(0, MAX_RECEIVED_PACKS);
    set({ received: Object.fromEntries(entries) });
    persist(get());
  },
  setOffered: (personKey, offer) => {
    const offered = { ...get().offered };
    if (offer) offered[personKey] = offer;
    else delete offered[personKey];
    set({ offered });
  },
  clearOffered: () => set({ offered: {} }),
}));

/** Friends are approved by central account; strangers by who they are on that server. */
export function getApprovalKey(personKey: string, offer: Pick<OfferedReactivePack, 'kind' | 'centralId'>): string {
  return offer.kind === 'friend' && offer.centralId ? `central:${offer.centralId}` : personKey;
}

/** Friends show unless blocked; strangers only once allowed. */
export function isOfferShown(personKey: string, offer: OfferedReactivePack, approvals: Record<string, ReactiveApproval>): boolean {
  const approval = approvals[getApprovalKey(personKey, offer)];
  return offer.kind === 'friend' ? approval !== 'blocked' : approval === 'allowed';
}
