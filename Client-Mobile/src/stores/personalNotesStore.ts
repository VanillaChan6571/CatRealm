import { create } from 'zustand';
import { createAuthenticatedApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import {
  deriveNotesKey,
  deriveLocalNotesKey,
  encryptNoteContent,
  decryptNoteContent,
  encryptWithPin,
  decryptWithPin,
} from '@/utils/notesCrypto';

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
  storageUsed: number;
  loading: boolean;
  error: string | null;
  fetchNotes: () => Promise<void>;
  fetchStorageInfo: () => Promise<void>;
  loadNoteContent: (id: string, options?: { totpCode?: string; pin?: string }) => Promise<PersonalNoteContent | null>;
  createNote: (title: string, body: string, options?: { pin?: string; use2fa?: boolean }) => Promise<string | null>;
  updateNote: (id: string, title: string, body: string, options?: { pin?: string; use2fa?: boolean; removeLock?: boolean }) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

const EMPTY_NOTES: PersonalNote[] = [];

function getApi() {
  return createAuthenticatedApi();
}

function getNotesKey(): Uint8Array | null {
  const { user, token, syncKey } = useAuthStore.getState() as {
    user: { id: string; accountType: string } | null;
    token: string | null;
    syncKey?: string | null;
  };
  if (!user || !token) return null;
  if (user.accountType === 'central' && syncKey) return deriveNotesKey(syncKey);
  if (user.id && token) return deriveLocalNotesKey(user.id, token);
  return null;
}

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error ?? fallback;
}

export const usePersonalNotesStore = create<PersonalNotesState>((set, get) => ({
  notes: EMPTY_NOTES,
  storageUsed: 0,
  loading: false,
  error: null,

  fetchNotes: async () => {
    set({ loading: true, error: null });
    try {
      const res = await getApi().get<{ notes: PersonalNote[] }>('/api/personal-notes');
      set({ notes: res.data.notes ?? EMPTY_NOTES, loading: false });
    } catch (err) {
      set({ loading: false, error: extractError(err, 'Failed to load notes') });
    }
  },

  fetchStorageInfo: async () => {
    try {
      const res = await getApi().get<{ used: number }>('/api/personal-notes/storage');
      set({ storageUsed: res.data.used ?? 0 });
    } catch {
      // non-fatal
    }
  },

  loadNoteContent: async (id, options = {}) => {
    try {
      const headers: Record<string, string> = {};
      if (options.totpCode) headers['X-TOTP-Code'] = options.totpCode;
      const res = await getApi().get<{
        encryptedContent: string;
        lockType: 'pin' | '2fa' | null;
        lockSalt: string | null;
      }>(`/api/personal-notes/${id}`, { headers });

      const { encryptedContent, lockType, lockSalt } = res.data;

      if (lockType === 'pin' && options.pin) {
        if (!lockSalt) throw new Error('Missing lock salt');
        const plaintext = decryptWithPin(encryptedContent, options.pin, lockSalt);
        return JSON.parse(plaintext) as PersonalNoteContent;
      }

      const key = getNotesKey();
      if (!key) throw new Error('No notes encryption key available');
      const plaintext = decryptNoteContent(encryptedContent, key);
      return JSON.parse(plaintext) as PersonalNoteContent;
    } catch (err) {
      if (err instanceof Error && err.message === 'Incorrect PIN') throw err;
      set({ error: extractError(err, 'Failed to load note') });
      return null;
    }
  },

  createNote: async (title, body, options = {}) => {
    const plaintext = JSON.stringify({ title, body, version: 1 });
    const lockType: 'pin' | '2fa' | null = options.use2fa ? '2fa' : options.pin ? 'pin' : null;
    let encryptedContent: string;
    let lockSalt: string | null = null;

    try {
      if (options.pin) {
        const result = encryptWithPin(plaintext, options.pin);
        encryptedContent = result.encrypted;
        lockSalt = result.salt;
      } else {
        const key = getNotesKey();
        if (!key) { set({ error: 'No encryption key available' }); return null; }
        encryptedContent = encryptNoteContent(plaintext, key);
      }

      const res = await getApi().post<{ id: string; createdAt: number; updatedAt: number }>(
        '/api/personal-notes',
        { title, encryptedContent, lockType, lockSalt },
      );

      const newNote: PersonalNote = {
        id: res.data.id,
        title,
        lockType,
        contentSize: encryptedContent.length,
        createdAt: res.data.createdAt,
        updatedAt: res.data.updatedAt,
      };
      set((s) => ({ notes: [newNote, ...s.notes] }));
      void get().fetchStorageInfo();
      return res.data.id;
    } catch (err) {
      set({ error: extractError(err, 'Failed to create note') });
      return null;
    }
  },

  updateNote: async (id, title, body, options = {}) => {
    const plaintext = JSON.stringify({ title, body, version: 1 });
    const lockType: 'pin' | '2fa' | null | undefined = options.removeLock
      ? null
      : options.use2fa ? '2fa' : options.pin ? 'pin' : undefined;
    let encryptedContent: string;
    let lockSalt: string | null | undefined = undefined;

    try {
      if (options.pin) {
        const result = encryptWithPin(plaintext, options.pin);
        encryptedContent = result.encrypted;
        lockSalt = result.salt;
      } else {
        const key = getNotesKey();
        if (!key) { set({ error: 'No encryption key available' }); return; }
        encryptedContent = encryptNoteContent(plaintext, key);
        if (options.removeLock) lockSalt = null;
      }

      await getApi().put(`/api/personal-notes/${id}`, {
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
                contentSize: encryptedContent.length,
                updatedAt: Math.floor(Date.now() / 1000),
              }
            : n,
        ),
      }));
      void get().fetchStorageInfo();
    } catch (err) {
      set({ error: extractError(err, 'Failed to update note') });
    }
  },

  deleteNote: async (id) => {
    try {
      await getApi().delete(`/api/personal-notes/${id}`);
      set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
      void get().fetchStorageInfo();
    } catch (err) {
      set({ error: extractError(err, 'Failed to delete note') });
    }
  },

  clearError: () => set({ error: null }),

  reset: () => set({ notes: EMPTY_NOTES, storageUsed: 0, loading: false, error: null }),
}));
