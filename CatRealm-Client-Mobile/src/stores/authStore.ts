/**
 * Auth store — central + local accounts, active server URL, token.
 *
 * Mirrors the public surface of CatRealm-Client/src/stores/authStore.ts but
 * trimmed to what the mobile shell currently needs. Persists to secureStorage
 * so users stay signed in across app restarts.
 *
 * IMPORTANT: never store tokens in plain AsyncStorage on native. Always go
 * through `secureStorage` (Keychain/Keystore-backed).
 */

import { create } from 'zustand';
import axios from 'axios';
import type { User, ServerInfo } from '@/types';
import {
  accountCentralDeviceSecretKey,
  accountDeviceDmPrivateKeyKey,
  accountDeviceIdKey,
  accountDeviceNotificationPrivateKeyKey,
  accountServerUrlKey,
  accountSyncKeyKey,
  accountTokenKey,
  accountUserKey,
  secureStorage,
  StorageKeys,
} from '@/lib/storage';
import {
  adoptCentralSessionDevice,
  centralDeviceHeaders,
  forgetCentralLoginDeviceCredentials,
  getCentralDeviceHeadersForUser,
  getCentralLoginDeviceCredentials,
} from '@/lib/centralDeviceCredentials';
import { disconnectSocket } from '@/lib/socket';
import { unregisterPushToken, unregisterVoipPushToken } from '@/lib/pushNotifications';
import { useSavedAccountsStore, type SavedAccount } from '@/stores/savedAccountsStore';
import { resetAllStores } from '@/lib/resetAllStores';
import { clearConversationSecretsForAccount } from '@/lib/dmSecretStorage';

const AUTH_BASE = (
  process.env.EXPO_PUBLIC_AUTH_SERVER_URL || 'https://auth.catrealm.app'
).replace(/\/+$/, '');

function clientHeaders() {
  return { 'X-CatRealm-Client': 'mobile' } as const;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const msg = error.response?.data?.error ?? error.response?.data?.message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
    if (error.response?.status === 401) return 'Invalid credentials.';
    if (error.response?.status === 429) return 'Too many attempts. Please wait.';
    if (!error.response) {
      const code = error.code?.toUpperCase();
      if (code === 'ECONNABORTED') {
        return 'Request timed out. Your network may be slow or blocked from reaching the internet.';
      }
      return 'No internet connection detected on this device, or the server is unreachable from this network.';
    }
  }
  return fallback;
}

function profileString(profile: Record<string, unknown>, camel: string, snake?: string): string | null | undefined {
  const value = profile[camel] ?? (snake ? profile[snake] : undefined);
  return typeof value === 'string' ? value : value === null ? null : undefined;
}

function profileNumber(profile: Record<string, unknown>, camel: string, snake?: string): number | null | undefined {
  const value = profile[camel] ?? (snake ? profile[snake] : undefined);
  return typeof value === 'number' ? value : value === null ? null : undefined;
}

function normalizeProfilePatch(profile: Record<string, unknown>): Partial<User> {
  const status = profileString(profile, 'status');
  return {
    avatar: profileString(profile, 'avatar') ?? null,
    banner: profileString(profile, 'banner') ?? null,
    bio: profileString(profile, 'bio') ?? null,
    pronouns: profileString(profile, 'pronouns') ?? null,
    status:
      status === 'online' || status === 'away' || status === 'sleeping' || status === 'invisible'
        ? status
        : 'online',
    displayName: profileString(profile, 'displayName', 'display_name') ?? null,
    customStatusText: profileString(profile, 'customStatusText', 'custom_status_text') ?? null,
    activityType: profileString(profile, 'activityType', 'activity_type') as User['activityType'],
    activityText: profileString(profile, 'activityText', 'activity_text') ?? null,
    activityStartedAt: profileNumber(profile, 'activityStartedAt', 'activity_started_at') ?? null,
  };
}

async function fetchOwnProfile(baseUrl: string, token: string, centralUserId?: string): Promise<Record<string, unknown>> {
  const res = await axios.get<Record<string, unknown>>(`${baseUrl}/api/profile/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...clientHeaders(),
      ...(centralUserId ? await getCentralDeviceHeadersForUser(centralUserId) : {}),
    },
    timeout: 10000,
  });
  return res.data;
}

async function revokeCentralSession(userId: string, token: string): Promise<void> {
  try {
    await axios.post(`${AUTH_BASE}/api/login/logout`, null, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...clientHeaders(),
        ...await getCentralDeviceHeadersForUser(userId),
      },
      timeout: 5000,
    });
  } catch {
    // An offline sign-out must still remove the local credentials.
  }
}

export interface AuthState {
  user: User | null;
  token: string | null;
  syncKey: string | null;
  /** URL of the currently-active CatRealm self-hosted server (or null for central-only). */
  serverUrl: string | null;
  /** Populated by fetchServerInfo; used by connect-server screen to determine auth mode. */
  serverInfo: ServerInfo | null;
  loading: boolean;
  error: string | null;
  /** Populated during central registration step 1; cleared after step 2 succeeds. */
  centralRegPending: { pendingId: string; qrCode: string; manualCode: string } | null;
  /** Set when a central session expires mid-flight; the UI should kick to login. */
  centralSessionExpired: boolean;
  /** Why the session expired ('key_rotated' = central restarted with a new key). */
  centralSessionExpiredReason: 'key_rotated' | null;
  accountSwitching: boolean;

  hydrate: () => Promise<void>;
  setSession: (args: {
    user: User;
    token: string;
    serverUrl?: string | null;
    syncKey?: string | null;
  }) => Promise<void>;
  updateUser: (patch: Partial<User>) => Promise<void>;
  applyProfile: (profile: Record<string, unknown>) => Promise<void>;
  setActiveServer: (url: string | null) => Promise<void>;
  expireCentralSession: (reason?: 'key_rotated' | null) => void;
  clearCentralSessionExpired: () => void;
  clearError: () => void;
  signOut: () => Promise<void>;

  /** Switch the active session to a previously-saved account. */
  switchToAccount: (userId: string) => Promise<string | null>;
  /** Add a central account (does not sign out first). Returns error string on failure. */
  addCentralAccount: (username: string, totpCode: string) => Promise<string | null>;
  /** Add a local account (does not sign out first). Returns error string on failure. */
  addLocalAccount: (serverUrl: string, username: string, password: string) => Promise<string | null>;
  /** Remove a non-active saved account and its per-account SecureStore keys. */
  removeFromSavedAccounts: (userId: string) => Promise<void>;

  fetchServerInfo: (rawUrl: string) => Promise<void>;
  localLogin: (username: string, password: string) => Promise<void>;
  localRegister: (username: string, password: string) => Promise<void>;
  centralLogin: (username: string, totpCode: string) => Promise<void>;
  centralRegisterStart: (username: string, captchaToken?: string) => Promise<void>;
  centralRegisterConfirm: (totpCode: string) => Promise<void>;
}

// Central decides per client whether registration needs hCaptcha. null when it
// can't be reached: registration is then attempted and Central's answer shown.
export async function fetchRegisterCaptchaConfig(): Promise<{ enabled: boolean; siteKey: string | null } | null> {
  try {
    const res = await axios.get<{ enabled?: boolean; siteKey?: string | null }>(
      `${AUTH_BASE}/api/register/hcaptcha-config`,
      { headers: clientHeaders(), timeout: 10000 },
    );
    const siteKey = typeof res.data?.siteKey === 'string' && res.data.siteKey ? res.data.siteKey : null;
    return { enabled: Boolean(res.data?.enabled) && Boolean(siteKey), siteKey };
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  syncKey: null,
  serverUrl: null,
  serverInfo: null,
  loading: false,
  error: null,
  centralRegPending: null,
  centralSessionExpired: false,
  centralSessionExpiredReason: null,
  accountSwitching: false,

  hydrate: async () => {
    const [token, userJson, serverUrl, syncKey] = await Promise.all([
      secureStorage.get(StorageKeys.authToken),
      secureStorage.get(StorageKeys.authUser),
      secureStorage.get(StorageKeys.activeServerUrl),
      secureStorage.get(StorageKeys.syncKey),
    ]);
    const user = userJson ? (JSON.parse(userJson) as User) : null;
    if (token && user?.accountType === 'central'
      && !Object.keys(await getCentralDeviceHeadersForUser(user.id)).length) {
      // Sessions created before device binding cannot authenticate again.
      await Promise.all([
        secureStorage.remove(StorageKeys.authToken),
        secureStorage.remove(StorageKeys.authUser),
        secureStorage.remove(StorageKeys.activeServerUrl),
        secureStorage.remove(StorageKeys.syncKey),
        secureStorage.remove(accountTokenKey(user.id)),
      ]);
      await useSavedAccountsStore.getState().load();
      set({ token: null, user: null, serverUrl: null, syncKey: null, centralSessionExpired: true });
      return;
    }
    set({
      token,
      user,
      serverUrl: serverUrl ?? null,
      syncKey: syncKey ?? null,
    });
    if (token && user) {
      // Backfill per-account keys and saved accounts list for sessions that
      // predate the multi-account feature (or any first hydrate after upgrade).
      await Promise.all([
        secureStorage.set(accountTokenKey(user.id), token),
        secureStorage.set(accountUserKey(user.id), JSON.stringify(user)),
        syncKey
          ? secureStorage.set(accountSyncKeyKey(user.id), syncKey)
          : secureStorage.remove(accountSyncKeyKey(user.id)),
        serverUrl
          ? secureStorage.set(accountServerUrlKey(user.id), serverUrl)
          : secureStorage.remove(accountServerUrlKey(user.id)),
      ]);
      await useSavedAccountsStore.getState().load();
      await useSavedAccountsStore.getState().addOrUpdate({
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? null,
        avatar: user.avatar ?? null,
        accountType: (user.accountType as 'central' | 'local') ?? 'local',
        serverUrl: serverUrl ?? null,
      });

      const baseUrl = user.accountType === 'central' ? AUTH_BASE : serverUrl;
      if (baseUrl) {
        try {
          await get().applyProfile(await fetchOwnProfile(baseUrl, token, user.accountType === 'central' ? user.id : undefined));
        } catch {
          // Keep the persisted session; profile refresh can retry in settings.
        }
      }
    }
  },

  setSession: async ({ user, token, serverUrl, syncKey }) => {
    await Promise.all([
      // Active session flat keys (used by all existing code)
      secureStorage.set(StorageKeys.authToken, token),
      secureStorage.set(StorageKeys.authUser, JSON.stringify(user)),
      syncKey
        ? secureStorage.set(StorageKeys.syncKey, syncKey)
        : secureStorage.remove(StorageKeys.syncKey),
      serverUrl
        ? secureStorage.set(StorageKeys.activeServerUrl, serverUrl)
        : secureStorage.remove(StorageKeys.activeServerUrl),
      // Per-account keys for multi-account switching
      secureStorage.set(accountTokenKey(user.id), token),
      secureStorage.set(accountUserKey(user.id), JSON.stringify(user)),
      syncKey
        ? secureStorage.set(accountSyncKeyKey(user.id), syncKey)
        : secureStorage.remove(accountSyncKeyKey(user.id)),
      serverUrl
        ? secureStorage.set(accountServerUrlKey(user.id), serverUrl)
        : secureStorage.remove(accountServerUrlKey(user.id)),
    ]);
    // Save account metadata to the saved accounts list
    const savedAccount: SavedAccount = {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? null,
      avatar: user.avatar ?? null,
      accountType: (user.accountType as 'central' | 'local') ?? 'local',
      serverUrl: serverUrl ?? null,
    };
    await useSavedAccountsStore.getState().addOrUpdate(savedAccount);
    set({
      user,
      token,
      syncKey: syncKey ?? null,
      serverUrl: serverUrl ?? null,
      centralSessionExpired: false,
      centralSessionExpiredReason: null,
      accountSwitching: false,
      error: null,
    });
  },

  updateUser: async (patch) => {
    const current = get().user;
    if (!current) return;
    const user = { ...current, ...patch };
    await Promise.all([
      secureStorage.set(StorageKeys.authUser, JSON.stringify(user)),
      secureStorage.set(accountUserKey(user.id), JSON.stringify(user)),
      useSavedAccountsStore.getState().addOrUpdate({
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? null,
        avatar: user.avatar ?? null,
        accountType: (user.accountType as 'central' | 'local') ?? 'local',
        serverUrl: get().serverUrl ?? null,
      }),
    ]);
    set({ user });
  },

  applyProfile: async (profile) => {
    await get().updateUser(normalizeProfilePatch(profile));
  },

  setActiveServer: async (url) => {
    if (url) await secureStorage.set(StorageKeys.activeServerUrl, url);
    else await secureStorage.remove(StorageKeys.activeServerUrl);
    set({ serverUrl: url });
  },

  expireCentralSession: (reason = null) => {
    if (get().accountSwitching) return;
    // Fully clear the active session, not just the flag: leaving a dead
    // token+user pair in the store made the login screen's "already signed in"
    // guard bounce straight back into the app shell, which then 401'd and
    // expired again — an endless home ⇄ login navigation loop. Saved-account
    // entries and per-account keys are kept so logging back in is one tap.
    disconnectSocket();
    void Promise.all([
      secureStorage.remove(StorageKeys.authToken),
      secureStorage.remove(StorageKeys.authUser),
      secureStorage.remove(StorageKeys.activeServerUrl),
      secureStorage.remove(StorageKeys.syncKey),
    ]).catch(() => {});
    set({
      user: null,
      token: null,
      syncKey: null,
      serverUrl: null,
      serverInfo: null,
      centralSessionExpired: true,
      centralSessionExpiredReason: reason,
    });
  },
  clearCentralSessionExpired: () => set({ centralSessionExpired: false, centralSessionExpiredReason: null }),
  clearError: () => set({ error: null }),

  signOut: async () => {
    resetAllStores();
    const currentUser = get().user;
    const currentToken = get().token;
    const revoke = currentUser?.accountType === 'central' && currentToken
      ? revokeCentralSession(currentUser.id, currentToken)
      : Promise.resolve();
    // Unregister push token before clearing auth (needs token still in store)
    try {
      const pushToken = await secureStorage.get(StorageKeys.pushToken);
      if (pushToken) {
        await unregisterPushToken(pushToken);
        await secureStorage.remove(StorageKeys.pushToken);
      }
      const voipToken = await secureStorage.get(StorageKeys.voipPushToken);
      if (voipToken) await unregisterVoipPushToken(voipToken);
    } catch {
      // Non-fatal
    }
    await revoke;
    disconnectSocket();
    const removals: Promise<void>[] = [
      secureStorage.remove(StorageKeys.authToken),
      secureStorage.remove(StorageKeys.authUser),
      secureStorage.remove(StorageKeys.activeServerUrl),
      secureStorage.remove(StorageKeys.syncKey),
    ];
    if (currentUser) {
      await clearConversationSecretsForAccount(currentUser.id).catch(() => {});
      removals.push(
        secureStorage.remove(accountTokenKey(currentUser.id)),
        secureStorage.remove(accountUserKey(currentUser.id)),
        secureStorage.remove(accountSyncKeyKey(currentUser.id)),
        secureStorage.remove(accountServerUrlKey(currentUser.id)),
        secureStorage.remove(accountDeviceIdKey(currentUser.id)),
        secureStorage.remove(accountCentralDeviceSecretKey(currentUser.id)),
        secureStorage.remove(accountDeviceDmPrivateKeyKey(currentUser.id)),
        secureStorage.remove(accountDeviceNotificationPrivateKeyKey(currentUser.id)),
        ...(currentUser.accountType === 'central' ? [forgetCentralLoginDeviceCredentials(currentUser.username)] : []),
      );
    }
    await Promise.all(removals);
    if (currentUser) {
      await useSavedAccountsStore.getState().remove(currentUser.id);
    }
    set({
      user: null,
      token: null,
      syncKey: null,
      serverUrl: null,
      serverInfo: null,
      centralRegPending: null,
      centralSessionExpired: false,
      centralSessionExpiredReason: null,
      accountSwitching: false,
      error: null,
    });
    resetAllStores();
  },

  fetchServerInfo: async (rawUrl) => {
    set({ loading: true, error: null, serverInfo: null });
    const url = normalizeUrl(rawUrl);
    try {
      const res = await axios.get<ServerInfo>(`${url}/api/server`, {
        headers: clientHeaders(),
        timeout: 10000,
      });
      await get().setActiveServer(url);
      set({ serverInfo: res.data, loading: false });
    } catch (err) {
      set({ error: extractErrorMessage(err, 'Failed to connect to server.'), loading: false });
    }
  },

  localLogin: async (username, password) => {
    set({ loading: true, error: null });
    const serverUrl = get().serverUrl;
    if (!serverUrl) {
      set({ loading: false, error: 'No server URL set. Connect to a server first.' });
      return;
    }
    try {
      const res = await axios.post<{ token: string; user: User }>(
        `${serverUrl}/api/auth/login`,
        { username, password },
        { headers: clientHeaders(), timeout: 15000 },
      );
      await get().setSession({ user: res.data.user, token: res.data.token, serverUrl });
      try {
        await get().applyProfile(await fetchOwnProfile(serverUrl, res.data.token));
      } catch {
        // Profile details can be fetched later from settings.
      }
      set({ loading: false });
    } catch (err) {
      set({ error: extractErrorMessage(err, 'Login failed.'), loading: false });
    }
  },

  localRegister: async (username, password) => {
    set({ loading: true, error: null });
    const serverUrl = get().serverUrl;
    if (!serverUrl) {
      set({ loading: false, error: 'No server URL set.' });
      return;
    }
    try {
      const res = await axios.post<{ token: string; user: User }>(
        `${serverUrl}/api/auth/register`,
        { username, password },
        { headers: clientHeaders(), timeout: 15000 },
      );
      await get().setSession({ user: res.data.user, token: res.data.token, serverUrl });
      try {
        await get().applyProfile(await fetchOwnProfile(serverUrl, res.data.token));
      } catch {
        // Profile details can be fetched later from settings.
      }
      set({ loading: false });
    } catch (err) {
      set({ error: extractErrorMessage(err, 'Registration failed.'), loading: false });
    }
  },

  centralLogin: async (username, totpCode) => {
    set({ loading: true, error: null });
    try {
      const credentials = await getCentralLoginDeviceCredentials(username);
      const res = await axios.post<{ token: string; user: Pick<User, 'id' | 'username'>; syncKey?: string | null }>(
        `${AUTH_BASE}/api/login`,
        { username, totpCode },
        { headers: { ...clientHeaders(), ...centralDeviceHeaders(credentials) }, timeout: 15000 },
      );
      await adoptCentralSessionDevice(res.data.user.id, res.data.user.username, res.data.token, credentials);
      await get().setSession({
        user: { ...res.data.user, accountType: 'central', status: 'online' },
        token: res.data.token,
        syncKey: res.data.syncKey ?? null,
      });
      try {
        await get().applyProfile(await fetchOwnProfile(AUTH_BASE, res.data.token, res.data.user.id));
      } catch {
        // Profile details can be fetched later from settings.
      }
      set({ loading: false });
    } catch (err) {
      set({ error: extractErrorMessage(err, 'Login failed.'), loading: false });
    }
  },

  centralRegisterStart: async (username, captchaToken) => {
    set({ loading: true, error: null, centralRegPending: null });
    try {
      const res = await axios.post<{ pendingId: string; qrCode: string; manualCode: string }>(
        `${AUTH_BASE}/api/register/start`,
        { username, captchaToken, acceptPrivacy: true, acceptTerms: true, confirmAge18: true, termsVersion: '2026-10-17', privacyVersion: '2026-10-17' },
        { headers: clientHeaders(), timeout: 15000 },
      );
      set({ centralRegPending: res.data, loading: false });
    } catch (err) {
      set({ error: extractErrorMessage(err, 'Could not start registration.'), loading: false });
    }
  },

  centralRegisterConfirm: async (totpCode) => {
    set({ loading: true, error: null });
    const pending = get().centralRegPending;
    if (!pending) {
      set({ loading: false, error: 'No pending registration.' });
      return;
    }
    try {
      await axios.post(
        `${AUTH_BASE}/api/register/confirm`,
        { pendingId: pending.pendingId, totpCode, acceptPrivacy: true, acceptTerms: true, confirmAge18: true, termsVersion: '2026-10-17', privacyVersion: '2026-10-17' },
        { headers: clientHeaders(), timeout: 15000 },
      );
      set({ centralRegPending: null, loading: false });
    } catch (err) {
      set({ error: extractErrorMessage(err, 'Verification failed.'), loading: false });
    }
  },

  switchToAccount: async (userId) => {
    const accounts = useSavedAccountsStore.getState().accounts;
    if (accounts.length >= 5 && !accounts.find((a) => a.id === userId)) {
      return 'Account limit reached.';
    }
    set({ accountSwitching: true });
    try {
      const [token, userJson, syncKey, serverUrl] = await Promise.all([
        secureStorage.get(accountTokenKey(userId)),
        secureStorage.get(accountUserKey(userId)),
        secureStorage.get(accountSyncKeyKey(userId)),
        secureStorage.get(accountServerUrlKey(userId)),
      ]);
      if (!token || !userJson) return 'Saved credentials not found. Please add the account again.';
      let user: User;
      try {
        user = JSON.parse(userJson) as User;
      } catch {
        return 'Saved credentials are corrupted. Please add the account again.';
      }
      if (user.accountType === 'central'
        && !Object.keys(await getCentralDeviceHeadersForUser(user.id)).length) {
        return 'This saved Central session needs a fresh sign-in in the updated Mobile Client.';
      }
      if (get().user?.accountType === 'central' && get().user?.id !== userId) {
        const [pushToken, voipToken] = await Promise.all([
          secureStorage.get(StorageKeys.pushToken),
          secureStorage.get(StorageKeys.voipPushToken),
        ]);
        if (pushToken) await unregisterPushToken(pushToken);
        if (voipToken) await unregisterVoipPushToken(voipToken);
      }
      disconnectSocket();
      resetAllStores();
      await get().setSession({ user, token, serverUrl: serverUrl ?? null, syncKey: syncKey ?? null });
      return null;
    } catch {
      return 'Could not switch accounts. Please try again.';
    } finally {
      if (get().accountSwitching) set({ accountSwitching: false });
    }
  },

  addCentralAccount: async (username, totpCode) => {
    const accounts = useSavedAccountsStore.getState().accounts;
    if (accounts.length >= 5) return 'You can only save up to 5 accounts.';
    set({ accountSwitching: true });
    try {
      const credentials = await getCentralLoginDeviceCredentials(username);
      const res = await axios.post<{ token: string; user: Pick<User, 'id' | 'username'>; syncKey?: string | null }>(
        `${AUTH_BASE}/api/login`,
        { username, totpCode },
        { headers: { ...clientHeaders(), ...centralDeviceHeaders(credentials) }, timeout: 15000 },
      );
      await adoptCentralSessionDevice(res.data.user.id, res.data.user.username, res.data.token, credentials);
      const user: User = { ...res.data.user, accountType: 'central', status: 'online' };
      if (get().user?.accountType === 'central' && get().user?.id !== user.id) {
        const [pushToken, voipToken] = await Promise.all([
          secureStorage.get(StorageKeys.pushToken),
          secureStorage.get(StorageKeys.voipPushToken),
        ]);
        if (pushToken) await unregisterPushToken(pushToken);
        if (voipToken) await unregisterVoipPushToken(voipToken);
      }
      disconnectSocket();
      resetAllStores();
      await get().setSession({ user, token: res.data.token, syncKey: res.data.syncKey ?? null });
      try {
        await get().applyProfile(await fetchOwnProfile(AUTH_BASE, res.data.token, res.data.user.id));
      } catch {
        // Profile details can be fetched later.
      }
      return null;
    } catch (err) {
      return extractErrorMessage(err, 'Login failed.');
    } finally {
      if (get().accountSwitching) set({ accountSwitching: false });
    }
  },

  addLocalAccount: async (serverUrl, username, password) => {
    const accounts = useSavedAccountsStore.getState().accounts;
    if (accounts.length >= 5) return 'You can only save up to 5 accounts.';
    const normalized = normalizeUrl(serverUrl);
    set({ accountSwitching: true });
    try {
      const res = await axios.post<{ token: string; user: User }>(
        `${normalized}/api/auth/login`,
        { username, password },
        { headers: clientHeaders(), timeout: 15000 },
      );
      if (get().user?.accountType === 'central') {
        const [pushToken, voipToken] = await Promise.all([
          secureStorage.get(StorageKeys.pushToken),
          secureStorage.get(StorageKeys.voipPushToken),
        ]);
        if (pushToken) await unregisterPushToken(pushToken);
        if (voipToken) await unregisterVoipPushToken(voipToken);
      }
      disconnectSocket();
      resetAllStores();
      await get().setSession({ user: res.data.user, token: res.data.token, serverUrl: normalized });
      try {
        await get().applyProfile(await fetchOwnProfile(normalized, res.data.token));
      } catch {
        // Profile details can be fetched later.
      }
      return null;
    } catch (err) {
      return extractErrorMessage(err, 'Login failed.');
    } finally {
      if (get().accountSwitching) set({ accountSwitching: false });
    }
  },

  removeFromSavedAccounts: async (userId) => {
    const account = useSavedAccountsStore.getState().accounts.find((entry) => entry.id === userId);
    if (account?.accountType === 'central') {
      const token = await secureStorage.get(accountTokenKey(userId));
      if (token) await revokeCentralSession(userId, token);
    }
    await clearConversationSecretsForAccount(userId);
    await Promise.all([
      secureStorage.remove(accountTokenKey(userId)),
      secureStorage.remove(accountUserKey(userId)),
      secureStorage.remove(accountSyncKeyKey(userId)),
      secureStorage.remove(accountServerUrlKey(userId)),
      secureStorage.remove(accountDeviceIdKey(userId)),
      secureStorage.remove(accountCentralDeviceSecretKey(userId)),
      secureStorage.remove(accountDeviceDmPrivateKeyKey(userId)),
      secureStorage.remove(accountDeviceNotificationPrivateKeyKey(userId)),
      ...(account?.accountType === 'central' ? [forgetCentralLoginDeviceCredentials(account.username)] : []),
    ]);
    await useSavedAccountsStore.getState().remove(userId);
  },
}));
