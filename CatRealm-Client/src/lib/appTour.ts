import { create } from 'zustand';
import { createAuthenticatedApi } from './authApi';

// Two flags, like the consent gate: the account (on Central) and this device
// (local storage, keyed by user id). Account never toured: run the tour.
// Account toured but not on this device: offer it. Both done: nothing.

const deviceKey = (userId: string) => `catrealm.app-tour-done.${userId}`;

export function hasDeviceSeenAppTour(userId: string): boolean {
  try {
    return localStorage.getItem(deviceKey(userId)) === '1';
  } catch {
    return true; // storage blocked: don't nag on every launch
  }
}

export function markDeviceSeenAppTour(userId: string) {
  try {
    localStorage.setItem(deviceKey(userId), '1');
  } catch { /* storage blocked; the tour may be offered again */ }
}

// The account decides first; the device flag only matters once the account
// has had the tour. Local accounts have no account flag, so pass the device's.
export function decideAppTour(accountDone: boolean, deviceDone: boolean): 'tour' | 'offer' | null {
  if (!accountDone) return 'tour';
  return deviceDone ? null : 'offer';
}

// null when Central can't be reached: callers then leave the user alone.
export async function fetchAccountAppTourDone(): Promise<boolean | null> {
  try {
    const res = await createAuthenticatedApi().get<{ completed: boolean }>('/api/app-tour');
    return res.data.completed === true;
  } catch {
    return null;
  }
}

export function markAccountAppTourDone() {
  void createAuthenticatedApi().post('/api/app-tour').catch(() => {});
}

interface AppTourState {
  open: boolean;
  start: () => void;
  stop: () => void;
}

export const useAppTourStore = create<AppTourState>((set) => ({
  open: false,
  start: () => set({ open: true }),
  stop: () => set({ open: false }),
}));
