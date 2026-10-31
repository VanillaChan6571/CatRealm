import { create } from 'zustand';
import axios from 'axios';
import { createAuthenticatedApi } from '../lib/authApi';
import { useAuthStore, setOnLogoutNotesCallback } from './authStore';
import {
  deriveNotesKey,
  deriveLocalNotesKey,
  encryptNoteContent,
  decryptNoteContent,
  encryptWithPin,
  decryptWithPin,
} from '../utils/notesCrypto';

export interface PersonalNote {
  id: string;
  title: string;
  lockType: 'pin' | '2fa' | null;
  contentSize: number;
  createdAt: number;
  updatedAt: number;
}

export interface PersonalNoteContent {
  title: string;
  body: string;
}

interface PersonalNotesState {
  notes: PersonalNote[];
  activeNoteId: string | null;
  storageUsed: number;
  loading: boolean;
  error: string | null;

  fetchNotes: () => Promise<void>;
  fetchStorageInfo: () => Promise<void>;
  loadNoteContent: (
    id: string,
    options?: { totpCode?: string; pin?: string }
  ) => Promise<PersonalNoteContent | null>;
  createNote: (
    title: string,
    body: string,
    options?: { pin?: string; use2fa?: boolean }
  ) => Promise<string | null>;
  updateNote: (
    id: string,
    title: string,
    body: string,
    options?: { pin?: string; use2fa?: boolean; removeLock?: boolean }
  ) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  setActiveNote: (id: string | null) => void;
  clearError: () => void;
  reset: () => void;
}

// Module-level constant to avoid ?? [] in selectors (avoids React error #185)
const EMPTY_NOTES: PersonalNote[] = [];

function getApi() {
  const { user, serverUrl, token } = useAuthStore.getState();
  if (user?.accountType === 'central') {
    return createAuthenticatedApi();
  }
  return axios.create({
    baseURL: serverUrl ?? '',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function getNotesKey(): Promise<CryptoKey | null> {
  const { user, token, syncKey } = useAuthStore.getState();
  if (!user || !token) return null;
  if (user.accountType === 'central' && syncKey) {
    return deriveNotesKey(syncKey);
  }
  if (user.accountType === 'local' && user.id && token) {
    return deriveLocalNotesKey(user.id, token);
  }
  return null;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string })?.error ?? fallback;
  }
  return fallback;
}

export const usePersonalNotesStore = create<PersonalNotesState>((set, get) => ({
  notes: EMPTY_NOTES,
  activeNoteId: null,
  storageUsed: 0,
  loading: false,
  error: null,

  fetchNotes: async () => {
    set({ loading: true, error: null });
    try {
      const api = getApi();
      const res = await api.get<{ notes: PersonalNote[] }>('/api/personal-notes');
      set({ notes: res.data.notes ?? EMPTY_NOTES, loading: false });
    } catch (err) {
      set({ loading: false, error: extractErrorMessage(err, 'Failed to load notes') });
    }
  },

  fetchStorageInfo: async () => {
    try {
      const api = getApi();
      const res = await api.get<{ used: number; limit: number }>('/api/personal-notes/storage');
      set({ storageUsed: res.data.used ?? 0 });
    } catch {
      // Non-fatal — storage bar just shows stale value
    }
  },

  loadNoteContent: async (id, options = {}) => {
    try {
      const api = getApi();
      const headers: Record<string, string> = {};
      if (options.totpCode) headers['X-TOTP-Code'] = options.totpCode;

      const res = await api.get<{
        encryptedContent: string;
        lockType: 'pin' | '2fa' | null;
        lockSalt: string | null;
      }>(`/api/personal-notes/${id}`, { headers });

      const { encryptedContent, lockType, lockSalt } = res.data;

      if (lockType === 'pin' && options.pin) {
        if (!lockSalt) throw new Error('Missing lock salt');
        const plaintext = await decryptWithPin(encryptedContent, options.pin, lockSalt);
        return JSON.parse(plaintext) as PersonalNoteContent;
      }

      // Regular note or 2FA-locked note (server already verified TOTP)
      const key = await getNotesKey();
      if (!key) throw new Error('No notes encryption key available');
      const plaintext = await decryptNoteContent(encryptedContent, key);
      return JSON.parse(plaintext) as PersonalNoteContent;
    } catch (err) {
      // Re-throw PIN errors so NoteUnlockDialog can show "Incorrect PIN"
      if (err instanceof Error && err.message === 'Incorrect PIN') throw err;
      set({ error: extractErrorMessage(err, 'Failed to load note') });
      return null;
    }
  },

  createNote: async (title, body, options = {}) => {
    const plaintext = JSON.stringify({ title, body, version: 1 });
    let encryptedContent: string;
    let lockSalt: string | null = null;
    const lockType: 'pin' | '2fa' | null = options.use2fa ? '2fa' : options.pin ? 'pin' : null;

    try {
      if (options.pin) {
        const result = await encryptWithPin(plaintext, options.pin);
        encryptedContent = result.encrypted;
        lockSalt = result.salt;
      } else {
        const key = await getNotesKey();
        if (!key) { set({ error: 'No encryption key available' }); return null; }
        encryptedContent = await encryptNoteContent(plaintext, key);
      }

      const api = getApi();
      const res = await api.post<{ id: string; createdAt: number; updatedAt: number }>(
        '/api/personal-notes',
        { title, encryptedContent, lockType, lockSalt },
      );

      const newNote: PersonalNote = {
        id: res.data.id,
        title,
        lockType,
        contentSize: new TextEncoder().encode(encryptedContent).length,
        createdAt: res.data.createdAt,
        updatedAt: res.data.updatedAt,
      };
      set((s) => ({ notes: [newNote, ...s.notes] }));
      void get().fetchStorageInfo();
      return res.data.id;
    } catch (err) {
      set({ error: extractErrorMessage(err, 'Failed to create note') });
      return null;
    }
  },

  updateNote: async (id, title, body, options = {}) => {
    const plaintext = JSON.stringify({ title, body, version: 1 });

    let encryptedContent: string;
    let lockSalt: string | null | undefined = undefined;
    const lockType: 'pin' | '2fa' | null | undefined = options.removeLock
      ? null
      : options.use2fa
        ? '2fa'
        : options.pin
          ? 'pin'
          : undefined;

    try {
      if (options.pin) {
        const result = await encryptWithPin(plaintext, options.pin);
        encryptedContent = result.encrypted;
        lockSalt = result.salt;
      } else {
        const key = await getNotesKey();
        if (!key) { set({ error: 'No encryption key available' }); return; }
        encryptedContent = await encryptNoteContent(plaintext, key);
        if (options.removeLock) lockSalt = null;
      }

      const api = getApi();
      await api.put(`/api/personal-notes/${id}`, {
        title,
        encryptedContent,
        ...(lockType !== undefined ? { lockType } : {}),
        ...(lockSalt !== undefined ? { lockSalt } : {}),
      });

      set((s) => ({
        notes: s.notes.map((n) =>
          n.id === id
            ? {
                ...n,
                title,
                lockType: lockType !== undefined ? lockType : n.lockType,
                contentSize: new TextEncoder().encode(encryptedContent).length,
                updatedAt: Math.floor(Date.now() / 1000),
              }
            : n,
        ),
      }));
      void get().fetchStorageInfo();
    } catch (err) {
      set({ error: extractErrorMessage(err, 'Failed to update note') });
    }
  },

  deleteNote: async (id) => {
    try {
      const api = getApi();
      await api.delete(`/api/personal-notes/${id}`);
      set((s) => ({
        notes: s.notes.filter((n) => n.id !== id),
        activeNoteId: s.activeNoteId === id ? null : s.activeNoteId,
      }));
      void get().fetchStorageInfo();
    } catch (err) {
      set({ error: extractErrorMessage(err, 'Failed to delete note') });
    }
  },

  setActiveNote: (id) => set({ activeNoteId: id }),
  clearError: () => set({ error: null }),

  reset: () => set({
    notes: EMPTY_NOTES,
    activeNoteId: null,
    storageUsed: 0,
    loading: false,
    error: null,
  }),
}));

// Register logout callback to clear notes when user logs out
setOnLogoutNotesCallback(() => {
  usePersonalNotesStore.getState().reset();
});
