import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys } from '@/lib/storage';

export interface SavedAccount {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  accountType: 'central' | 'local';
  serverUrl: string | null;
}

const MAX_ACCOUNTS = 5;

interface SavedAccountsState {
  accounts: SavedAccount[];
  addOrUpdate: (account: SavedAccount) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  load: () => Promise<void>;
}

async function persist(accounts: SavedAccount[]) {
  await AsyncStorage.setItem(StorageKeys.savedAccountsList, JSON.stringify(accounts));
}

export const useSavedAccountsStore = create<SavedAccountsState>((set, get) => ({
  accounts: [],

  addOrUpdate: async (account) => {
    const current = get().accounts;
    const idx = current.findIndex((a) => a.id === account.id);
    let next: SavedAccount[];
    if (idx >= 0) {
      next = current.map((a, i) => (i === idx ? account : a));
    } else if (current.length < MAX_ACCOUNTS) {
      next = [...current, account];
    } else {
      // At limit — update if already present, otherwise silently skip
      next = current;
    }
    set({ accounts: next });
    await persist(next);
  },

  remove: async (userId) => {
    const next = get().accounts.filter((a) => a.id !== userId);
    set({ accounts: next });
    await persist(next);
  },

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(StorageKeys.savedAccountsList);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedAccount[];
        set({ accounts: parsed });
      }
    } catch {
      // ignore — list starts empty
    }
  },
}));
