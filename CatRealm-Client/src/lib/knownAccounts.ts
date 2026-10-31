import type { User } from '../types';

// Central accounts this device has signed in to, for the Switch Accounts list.
// Profile details only: no tokens are kept, so switching always re-authenticates.
export interface KnownAccount {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
}

const KEY = 'catrealm.known-accounts';
const MAX_ACCOUNTS = 8;

export function loadKnownAccounts(): KnownAccount[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((a): a is KnownAccount => typeof a?.id === 'string' && typeof a?.username === 'string')
      : [];
  } catch {
    return [];
  }
}

function save(accounts: KnownAccount[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(accounts.slice(0, MAX_ACCOUNTS)));
  } catch { /* storage full or blocked; the list is a convenience */ }
}

export function rememberKnownAccount(user: User) {
  if (user.accountType !== 'central') return;
  const entry: KnownAccount = {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? null,
    avatar: user.avatar ?? null,
  };
  save([entry, ...loadKnownAccounts().filter((a) => a.id !== user.id)]);
}

export function forgetKnownAccount(id: string) {
  save(loadKnownAccounts().filter((a) => a.id !== id));
}
