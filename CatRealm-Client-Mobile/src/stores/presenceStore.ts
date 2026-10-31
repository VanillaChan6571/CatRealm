/**
 * Presence store — who's online, away, sleeping, invisible.
 * Real implementation: CatRealm-Client/src/stores/presenceStore.ts.
 *
 * Mirrors the desktop dual-array pattern:
 *   onlineUsers — currently socket-connected users (from presence:update)
 *   allMembers  — all server members (from /api/users)
 * Offline status is derived by set difference, never from the DB status field.
 *
 *   byUserId        — realm presence (presence:update on the active realm socket)
 *   centralByUserId — Central presence (friends + DM conversations, refreshed on
 *                     friends:sync). Kept apart so the active realm's roster can't
 *                     flatten a friend's Central "away" to offline.
 */

import { create } from 'zustand';
import type { UserStatus, ActivityType, OnlineUser, PresenceClient } from '@/types';

export interface PresenceEntry {
  userId: string;
  status: UserStatus;
  customStatusText?: string | null;
  activityType?: ActivityType | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  clients?: PresenceClient[];
}

export interface PresenceState {
  byUserId: Record<string, PresenceEntry>;
  centralByUserId: Record<string, PresenceEntry>;
  onlineUsers: OnlineUser[];
  allMembers: OnlineUser[];
  upsert: (entry: PresenceEntry) => void;
  upsertMany: (entries: PresenceEntry[]) => void;
  remove: (userId: string) => void;
  /** Merges into Central presence; omitted fields keep their previous value. */
  upsertCentral: (entries: PresenceEntry[]) => void;
  setOnlineUsers: (users: OnlineUser[]) => void;
  setAllMembers: (users: OnlineUser[]) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  byUserId: {},
  centralByUserId: {},
  onlineUsers: [],
  allMembers: [],

  upsert: (entry) =>
    set((s) => ({ byUserId: { ...s.byUserId, [entry.userId]: entry } })),
  upsertMany: (entries) =>
    set((s) => {
      const next = { ...s.byUserId };
      entries.forEach((e) => {
        next[e.userId] = e;
      });
      return { byUserId: next };
    }),
  remove: (userId) =>
    set((s) => {
      const next = { ...s.byUserId };
      delete next[userId];
      return { byUserId: next };
    }),

  upsertCentral: (entries) =>
    set((s) => {
      const next = { ...s.centralByUserId };
      entries.forEach((e) => {
        next[e.userId] = { ...next[e.userId], ...e };
      });
      return { centralByUserId: next };
    }),

  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),
  setAllMembers: (allMembers) => set({ allMembers }),
}));
