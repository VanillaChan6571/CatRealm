import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Channel } from '../types';

// A taskbar-pinned conversation. Each variant caches enough display metadata to
// render its chip even when the parent list (channel list / DM list / group list)
// is not currently loaded — e.g. a channel pinned on server X while the user is
// on server Y or home.
export type PinnedItem =
  | {
      type: 'channel';
      serverUrl: string;
      channelId: string;
      name: string;
      channelType: Channel['type'];
      serverIcon: string | null;
      serverName: string;
    }
  | {
      type: 'dm';
      otherUserId: string;
      username: string;
      avatar: string | null;
    }
  | {
      type: 'group';
      groupId: string;
      name: string;
      avatar: string | null;
    };

// Stable identity for dedupe, isPinned checks, and React keys.
export function pinKey(item: PinnedItem): string {
  switch (item.type) {
    case 'channel':
      return `channel:${item.serverUrl}:${item.channelId}`;
    case 'dm':
      return `dm:${item.otherUserId}`;
    case 'group':
      return `group:${item.groupId}`;
  }
}

export type DockSide = 'bottom' | 'top' | 'left' | 'right';

interface PinnedState {
  pinnedItems: PinnedItem[];
  // Which window edge the taskbar is docked to. Persisted.
  dockSide: DockSide;
  // When true, the drag-to-reposition handle is disabled. Persisted.
  locked: boolean;
  // When docked left/right, render chips with vertical (rotated) labels. Persisted.
  rotated: boolean;
  // A pin/unpin awaiting confirmation in the modal. null when no prompt is open.
  pendingConfirm: { item: PinnedItem; action: 'pin' | 'unpin' } | null;
  setDockSide: (side: DockSide) => void;
  toggleLocked: () => void;
  toggleRotated: () => void;
  addPin: (item: PinnedItem) => void;
  removePin: (key: string) => void;
  // Replace the DM-type pins with a synced set/order from Central, preserving
  // channel/group pins and their positions. Used by cross-device pin sync.
  setDmPins: (dmPins: { otherUserId: string; username: string; avatar: string | null }[]) => void;
  togglePin: (item: PinnedItem) => void;
  isPinned: (key: string) => boolean;
  reorderPins: (orderedKeys: string[]) => void;
  clearPins: () => void;
  // Entry point for every pin/unpin gesture: opens the confirmation modal, or
  // applies the change immediately when bypassModal is true (Shift-click).
  requestTogglePin: (item: PinnedItem, bypassModal?: boolean) => void;
  confirmPendingPin: () => void;
  cancelPendingPin: () => void;
}

export const usePinnedStore = create<PinnedState>()(
  persist(
    (set, get) => ({
      pinnedItems: [],
      dockSide: 'bottom',
      locked: false,
      rotated: false,
      pendingConfirm: null,
      setDockSide: (side) => set({ dockSide: side }),
      toggleLocked: () => set((s) => ({ locked: !s.locked })),
      toggleRotated: () => set((s) => ({ rotated: !s.rotated })),
      addPin: (item) =>
        set((state) => {
          const key = pinKey(item);
          if (state.pinnedItems.some((p) => pinKey(p) === key)) return state;
          return { pinnedItems: [...state.pinnedItems, item] };
        }),
      removePin: (key) =>
        set((state) => ({
          pinnedItems: state.pinnedItems.filter((p) => pinKey(p) !== key),
        })),
      setDmPins: (dmPins) =>
        set((state) => {
          const centralItems: PinnedItem[] = dmPins.map((p) => ({
            type: 'dm',
            otherUserId: p.otherUserId,
            username: p.username,
            avatar: p.avatar ?? null,
          }));
          // Keep non-DM pins in place; slot the synced DM pins into the positions
          // DM pins currently occupy, appending any extras near the DM cluster.
          const result: PinnedItem[] = [];
          let consumed = 0;
          let lastDmSlot = -1;
          for (const item of state.pinnedItems) {
            if (item.type === 'dm') {
              if (consumed < centralItems.length) {
                result.push(centralItems[consumed++]);
                lastDmSlot = result.length;
              }
              // surplus local DM slot with no synced counterpart → dropped
            } else {
              result.push(item);
            }
          }
          if (consumed < centralItems.length) {
            const remaining = centralItems.slice(consumed);
            if (lastDmSlot >= 0) result.splice(lastDmSlot, 0, ...remaining);
            else result.push(...remaining);
          }
          return { pinnedItems: result };
        }),
      togglePin: (item) => {
        const key = pinKey(item);
        if (get().pinnedItems.some((p) => pinKey(p) === key)) {
          get().removePin(key);
        } else {
          get().addPin(item);
        }
      },
      isPinned: (key) => get().pinnedItems.some((p) => pinKey(p) === key),
      reorderPins: (orderedKeys) =>
        set((state) => {
          const byKey = new Map(state.pinnedItems.map((p) => [pinKey(p), p] as const));
          const next: PinnedItem[] = [];
          for (const k of orderedKeys) {
            const it = byKey.get(k);
            if (it) {
              next.push(it);
              byKey.delete(k);
            }
          }
          // Preserve any items not named in the ordered list (safety).
          for (const it of byKey.values()) next.push(it);
          return { pinnedItems: next };
        }),
      clearPins: () => set({ pinnedItems: [], pendingConfirm: null }),
      requestTogglePin: (item, bypassModal = false) => {
        const action: 'pin' | 'unpin' = get().isPinned(pinKey(item)) ? 'unpin' : 'pin';
        if (bypassModal) {
          if (action === 'pin') get().addPin(item);
          else get().removePin(pinKey(item));
          return;
        }
        set({ pendingConfirm: { item, action } });
      },
      confirmPendingPin: () => {
        const pending = get().pendingConfirm;
        if (!pending) return;
        if (pending.action === 'pin') get().addPin(pending.item);
        else get().removePin(pinKey(pending.item));
        set({ pendingConfirm: null });
      },
      cancelPendingPin: () => set({ pendingConfirm: null }),
    }),
    {
      name: 'catrealm-pinned-items',
      // Persist pins + layout prefs; the transient confirmation state must not persist.
      partialize: (state) => ({
        pinnedItems: state.pinnedItems,
        dockSide: state.dockSide,
        locked: state.locked,
        rotated: state.rotated,
      }),
    }
  )
);
