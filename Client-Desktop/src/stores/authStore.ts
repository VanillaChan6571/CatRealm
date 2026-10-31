import { create } from 'zustand';
import axios from 'axios';
import type { ServerInfo, User, CentralRegPending } from '../types';
import { authApi, createAuthenticatedApi, refreshCentralSessionIfNeeded, AUTH_BASE, getCentralDeviceHeaders } from '../lib/authApi';
import { createApi } from '../lib/api';
import { reconcileIncomingCentralProfileActivity, scheduleStaleCentralProfileActivityClear } from '../lib/centralProfileActivity';
import { saveSession, loadSession, clearSession, clearServers, decodeToken, parseTokenUser } from '../utils/token';
import { disconnectSocket } from '../lib/socket';
import { clearAllDMStorage } from '../messaging/persistence/dmStorage';
import { usePinnedStore } from './pinnedStore';
import { adoptCentralSessionDevice } from '../lib/centralDeviceCredentials';
import { clearLocalConversationSecrets } from '../lib/deviceIdentity';

// Callback for resetting serverStore on logout (set by serverStore to avoid circular dep)
let onLogoutCallback: ((keepServers: boolean) => void) | null = null;
export function setOnLogoutCallback(cb: (keepServers: boolean) => void) {
  onLogoutCallback = cb;
}

let updateServerTokenCallback: ((url: string, token: string) => void) | null = null;
export function setUpdateServerTokenCallback(cb: (url: string, token: string) => void) {
  updateServerTokenCallback = cb;
}

// Callback for clearing personal notes on logout (set by personalNotesStore to avoid circular dep)
let onLogoutNotesCallback: (() => void) | null = null;
export function setOnLogoutNotesCallback(cb: () => void) {
  onLogoutNotesCallback = cb;
}

// Callback for cleaning up voice on logout (set by voiceStore to avoid circular dep)
let onLogoutVoiceCallback: (() => void) | null = null;
export function setOnLogoutVoiceCallback(cb: () => void) {
  onLogoutVoiceCallback = cb;
}

interface AuthState {
  serverUrl: string | null;
  serverInfo: ServerInfo | null;
  token: string | null;
  syncKey: string | null;
  user: User | null;
  isAuthenticated: boolean;
  centralRegPending: CentralRegPending | null;
  error: string | null;
  loading: boolean;

  setServerUrl: (url: string) => Promise<void>;
  localLogin: (username: string, password: string) => Promise<void>;
  localRegister: (username: string, password: string) => Promise<void>;
  centralLogin: (username: string, totpCode: string) => Promise<void>;
  centralRegisterStart: (username: string, captchaToken: string) => Promise<void>;
  centralRegisterConfirm: (totpCode: string) => Promise<void>;
  clearCentralReg: () => void;
  logout: () => void;
  restoreSession: () => void;
  claimAdmin: (adminToken: string) => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
  applyServerAuthRefresh: (payload: { serverUrl?: string | null; token?: string | null; user?: Partial<User> | null }) => void;
  setOnboardingCompleted: () => void;
  clearError: () => void;
  disconnect: () => void;
  expireCentralSession: (error?: string | null) => void;
  centralLoginWithToken: (token: string, userId: string, username: string, syncKey: string | null) => void;
  switchCentralAccount: (token: string, authUser: { id: string; username: string }, syncKey: string | null) => Promise<void>;
}

function revokeCentralToken(token: string) {
  return axios.post(`${AUTH_BASE}/api/login/logout`, null, { headers: { Authorization: `Bearer ${token}`, ...getCentralDeviceHeaders() } })
    .then(() => {}, () => {});
}

const CENTRAL_PROFILE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000];
let centralProfileRetryTimer: ReturnType<typeof setTimeout> | null = null;

// The central token only carries id + username; avatar, display name and the
// rest come from /api/profile/me. If that fetch fails (rate limit, network
// blip) the user would sit on their username and a letter avatar until the
// next socket reconnect, so retry with backoff while they stay signed in.
function loadCentralProfile(source: string, userId: string, attempt = 0) {
  if (centralProfileRetryTimer) {
    clearTimeout(centralProfileRetryTimer);
    centralProfileRetryTimer = null;
  }
  createAuthenticatedApi().get('/api/profile/me')
    .then((profileRes) => {
      const reconciledActivity = reconcileIncomingCentralProfileActivity({
        source,
        userId: profileRes.data.id ?? userId,
        activityType: profileRes.data.activityType ?? profileRes.data.activity_type ?? null,
        activityText: profileRes.data.activityText ?? profileRes.data.activity_text ?? null,
        activityStartedAt: profileRes.data.activityStartedAt ?? profileRes.data.activity_started_at ?? null,
      });
      if (reconciledActivity.shouldClearUpstream) {
        scheduleStaleCentralProfileActivityClear({
          source,
          userId: profileRes.data.id ?? userId,
        });
      }
      useAuthStore.setState((state) => {
        if (!state.user) return state;
        return {
          user: {
            ...state.user,
            avatar: profileRes.data.avatar ?? null,
            banner: profileRes.data.banner ?? null,
            bio: profileRes.data.bio ?? null,
            status: profileRes.data.status ?? 'online',
            displayName: profileRes.data.display_name ?? null,
            customStatusText: profileRes.data.customStatusText ?? profileRes.data.custom_status_text ?? null,
            socialProfileEnabled: profileRes.data.socialProfileEnabled
              ?? (profileRes.data.social_profile_enabled === true || profileRes.data.social_profile_enabled === 1),
            socialProfileConfig: profileRes.data.socialProfileConfig ?? profileRes.data.social_profile_config ?? null,
            activityType: reconciledActivity.activityType,
            activityText: reconciledActivity.activityText,
            activityStartedAt: reconciledActivity.activityStartedAt,
          },
        };
      });
    })
    .catch((err) => {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      // A rejected token is the session-expiry path's job, not a retry's.
      if (status === 401 || status === 403) return;
      const delay = CENTRAL_PROFILE_RETRY_DELAYS_MS[Math.min(attempt, CENTRAL_PROFILE_RETRY_DELAYS_MS.length - 1)];
      centralProfileRetryTimer = setTimeout(() => {
        centralProfileRetryTimer = null;
        const { user, isAuthenticated } = useAuthStore.getState();
        // Stop on sign-out/account switch, or once another path (the DM
        // socket's refresh on connect) has already filled the profile in.
        if (!isAuthenticated || user?.id !== userId || user.avatar) return;
        loadCentralProfile(source, userId, attempt + 1);
      }, delay);
    });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  serverUrl: null,
  serverInfo: null,
  token: null,
  syncKey: null,
  user: null,
  isAuthenticated: false,
  centralRegPending: null,
  error: null,
  loading: false,

  setServerUrl: async (url: string) => {
    let serverUrl = url.replace(/\/+$/, '');
    const isSecureContext = typeof window !== 'undefined' && window.location.protocol === 'https:';
    if (!/^https?:\/\//i.test(serverUrl)) {
      serverUrl = `${isSecureContext ? 'https' : 'http'}://${serverUrl}`;
    } else if (isSecureContext) {
      serverUrl = serverUrl.replace(/^http:\/\//i, 'https://');
    }
    set({ loading: true, error: null });
    try {
      const res = await axios.get(`${serverUrl}/api/server`);
      set({ serverUrl, serverInfo: res.data, loading: false });
    } catch {
      const msg = isSecureContext
        ? 'Could not connect to server. The server may not support HTTPS, which is required when using the web client. Try the desktop app for HTTP servers.'
        : 'Could not connect to server';
      set({ loading: false, error: msg });
    }
  },

  localLogin: async (username, password) => {
    const { serverUrl } = get();
    set({ loading: true, error: null });
    try {
      const res = await axios.post(`${serverUrl}/api/auth/login`, { username, password });
      const { token, user } = res.data;
      set({ token, user, isAuthenticated: true, loading: false });
      saveSession(token, serverUrl!, user, null);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Login failed';
      set({ loading: false, error: msg || 'Login failed' });
    }
  },

  localRegister: async (username, password) => {
    const { serverUrl } = get();
    set({ loading: true, error: null });
    try {
      const res = await axios.post(`${serverUrl}/api/auth/register`, { username, password });
      const { token, user } = res.data;
      set({ token, user, isAuthenticated: true, loading: false });
      saveSession(token, serverUrl!, user, null);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Registration failed';
      set({ loading: false, error: msg || 'Registration failed' });
    }
  },

  centralLogin: async (username, totpCode) => {
    set({ loading: true, error: null });
    try {
      const res = await authApi.post('/api/login', { username, totpCode });
      const { token, user: authUser, syncKey } = res.data;
      adoptCentralSessionDevice(token);
      const user: User = {
        id: authUser.id,
        username: authUser.username,
        accountType: 'central',
        permissions: 0,
      };
      // For central accounts, save session without serverUrl
      set({ token, user, syncKey: syncKey ?? null, isAuthenticated: true, loading: false });
      saveSession(token, null, user, syncKey ?? null);
      // Fetch central profile details (avatar, bio, status, displayName)
      loadCentralProfile('auth:central-login', authUser.id);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Login failed';
      set({ loading: false, error: msg || 'Invalid username or 2FA code' });
    }
  },

  centralRegisterStart: async (username, captchaToken) => {
    set({ loading: true, error: null });
    try {
      const res = await authApi.post('/api/register/start', { username, captchaToken, acceptPrivacy: true, acceptTerms: true, confirmAge18: true, termsVersion: '2026-10-17', privacyVersion: '2026-10-17' });
      set({
        centralRegPending: {
          pendingId: res.data.pendingId,
          qrCode: res.data.qrCode,
          manualCode: res.data.manualCode,
        },
        loading: false,
      });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Registration failed';
      set({ loading: false, error: msg || 'Registration failed' });
    }
  },

  centralRegisterConfirm: async (totpCode) => {
    const { centralRegPending } = get();
    if (!centralRegPending) return;
    set({ loading: true, error: null });
    try {
      await authApi.post('/api/register/confirm', {
        pendingId: centralRegPending.pendingId,
        totpCode,
        acceptPrivacy: true,
        acceptTerms: true,
        confirmAge18: true,
        termsVersion: '2026-10-17',
        privacyVersion: '2026-10-17',
      });
      set({ centralRegPending: null, loading: false });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Confirmation failed';
      set({ loading: false, error: msg || 'Invalid TOTP code' });
    }
  },

  clearCentralReg: () => set({ centralRegPending: null }),

  logout: () => {
    const current = get();
    if (current.user?.accountType === 'central' && current.token) {
      void revokeCentralToken(current.token);
    }
    onLogoutVoiceCallback?.();
    onLogoutNotesCallback?.();
    disconnectSocket();
    clearSession();
    clearLocalConversationSecrets();
    clearAllDMStorage(); // Clear DM IndexedDB on logout
    usePinnedStore.getState().clearPins(); // Pins are per-device; don't leak across accounts
    set({
      serverUrl: null,
      serverInfo: null,
      token: null,
      syncKey: null,
      user: null,
      isAuthenticated: false,
      centralRegPending: null,
      error: null,
      loading: false,
    });
    clearServers();
    onLogoutCallback?.(false);
  },

  restoreSession: () => {
    const session = loadSession();
    if (!session) return;

    const payload = decodeToken(session.token);
    if (!payload) {
      clearSession();
      return;
    }

    const exp = payload.exp as number | undefined;
    if (exp && exp * 1000 < Date.now()) {
      if (payload.type === 'central' && typeof window !== 'undefined' && window.electron) {
        const user = parseTokenUser(payload);
        set({
          token: session.token,
          user,
          syncKey: session.syncKey ?? null,
          isAuthenticated: true,
        });
        void refreshCentralSessionIfNeeded({ force: true }).then((nextToken) => {
          if (!nextToken) get().expireCentralSession();
        });
        return;
      }
      clearSession();
      return;
    }

    const user = parseTokenUser(payload);

    if (user.accountType === 'central') {
      // Guard: if a server token was mistakenly stored as the central session, force re-login
      if (payload.type !== 'central') {
        set({
          serverUrl: null,
          serverInfo: null,
          token: null,
          syncKey: null,
          user: null,
          isAuthenticated: false,
          centralRegPending: null,
          error: 'Your session became invalid. Please log in again.',
        });
        clearSession();
        return;
      }
      // Central accounts: restore auth without serverUrl
      set({
        token: session.token,
        user,
        syncKey: session.syncKey ?? null,
        isAuthenticated: true,
      });
      // Server list will be loaded by serverStore separately
      loadCentralProfile('auth:restore-session', user.id);
    } else {
      // Decentralized accounts: restore with serverUrl (legacy behavior)
      // Merge stored user to preserve fields not in JWT (e.g. onboardingCompleted)
      const restoredUser: User = { ...user };
      if (session.user && typeof session.user === 'object') {
        if (typeof (session.user as User).onboardingCompleted === 'boolean') {
          restoredUser.onboardingCompleted = (session.user as User).onboardingCompleted;
        }
      }
      set({
        token: session.token,
        serverUrl: session.serverUrl ?? null,
        user: restoredUser,
        syncKey: null,
        isAuthenticated: true,
      });

      // Fetch server info in background
      if (session.serverUrl) {
        axios.get(`${session.serverUrl}/api/server`)
          .then((res) => set({ serverInfo: res.data }))
          .catch(() => { /* server might be down, that's ok for now */ });
      }
    }
  },

  claimAdmin: async (adminToken: string) => {
    set({ loading: true, error: null });
    try {
      const api = createApi();
      const res = await api.post('/api/auth/claim-admin', { token: adminToken });
      const { token: newToken, user } = res.data;
      const state = get();
      if (state.user?.accountType === 'central') {
        const activeUrl = state.serverUrl;
        if (activeUrl && updateServerTokenCallback) {
          updateServerTokenCallback(activeUrl, newToken);
        }
        set({ user, loading: false });
        saveSession(state.token!, null, user, state.syncKey);
      } else {
        set({ token: newToken, user, loading: false });
        const { serverUrl } = get();
        saveSession(newToken, serverUrl!, user, null);
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const serverMsg = err.response?.data?.error;
        if (status === 503) {
          set({
            loading: false,
            error: serverMsg || 'Could not reach CatRealm auth server. Central accounts require it. Try a local account or check server internet access.',
          });
          return;
        }
        set({ loading: false, error: serverMsg || 'Invalid admin token' });
        return;
      }
      set({ loading: false, error: 'Failed to claim admin' });
    }
  },

  updateUser: (patch) => {
    set((state) => {
      if (!state.user) return state;
      const nextUser = { ...state.user, ...patch };
      if (state.user.accountType === 'local' && state.serverUrl) {
        saveSession(state.token!, state.serverUrl, nextUser, null);
      } else {
        saveSession(state.token!, null, nextUser, state.syncKey);
      }
      return { user: nextUser };
    });
  },

  setOnboardingCompleted: () => {
    set((state) => {
      if (!state.user) return state;
      return { user: { ...state.user, onboardingCompleted: true } };
    });
  },

  applyServerAuthRefresh: ({ serverUrl, token, user: nextUserPatch }) => {
    set((state) => {
      const currentUser = state.user;
      if (!currentUser) return state;

      let nextToken = state.token;
      if (token) {
        if (currentUser.accountType === 'central') {
          const scopedUrl = serverUrl || state.serverUrl;
          if (scopedUrl && updateServerTokenCallback) {
            updateServerTokenCallback(scopedUrl, token);
          }
        } else {
          nextToken = token;
        }
      }

      let nextUser = currentUser;
      if (nextUserPatch && typeof nextUserPatch === 'object') {
        if (currentUser.accountType === 'central') {
          nextUser = {
            ...currentUser,
            serverUserId: typeof nextUserPatch.id === 'string' ? nextUserPatch.id : (currentUser.serverUserId ?? null),
            role: typeof nextUserPatch.role === 'string' ? nextUserPatch.role : currentUser.role,
            permissions: typeof nextUserPatch.permissions === 'number' ? nextUserPatch.permissions : currentUser.permissions,
            isOwner: typeof nextUserPatch.isOwner === 'boolean' ? nextUserPatch.isOwner : currentUser.isOwner,
            verified: typeof nextUserPatch.verified === 'boolean' ? nextUserPatch.verified : currentUser.verified,
            onboardingCompleted: typeof nextUserPatch.onboardingCompleted === 'boolean'
              ? nextUserPatch.onboardingCompleted
              : currentUser.onboardingCompleted,
            viewAsRole: nextUserPatch.viewAsRole === undefined ? currentUser.viewAsRole : (nextUserPatch.viewAsRole ?? null),
          };
        } else {
          nextUser = {
            ...currentUser,
            ...nextUserPatch,
          };
        }
      }

      if (nextUser.accountType === 'local' && state.serverUrl) {
        saveSession(nextToken!, state.serverUrl, nextUser, null);
      } else {
        saveSession(state.token!, null, nextUser, state.syncKey);
      }

      return {
        token: nextToken,
        user: nextUser,
      };
    });
  },

  clearError: () => set({ error: null }),

  centralLoginWithToken: (token, userId, username, syncKey) => {
    adoptCentralSessionDevice(token);
    const user: User = { id: userId, username, accountType: 'central', permissions: 0 };
    set({ token, user, syncKey: syncKey ?? null, isAuthenticated: true, loading: false });
    saveSession(token, null, user, syncKey ?? null);
    loadCentralProfile('auth:central-login-with-token', userId);
  },

  // The new account is already authenticated: tear down the old session the
  // same way logout does, persist the new one, then reload so every store,
  // socket and DM cache starts clean under the new identity.
  switchCentralAccount: async (token, authUser, syncKey) => {
    const previous = get();
    const revoked = previous.user?.accountType === 'central' && previous.token
      ? revokeCentralToken(previous.token)
      : Promise.resolve();
    set({ token: null }); // logout must not revoke a second time
    get().logout();
    adoptCentralSessionDevice(token);
    saveSession(token, null, { id: authUser.id, username: authUser.username, accountType: 'central', permissions: 0 }, syncKey);
    await Promise.race([revoked, new Promise((resolve) => setTimeout(resolve, 2500))]);
    window.location.reload();
  },

  expireCentralSession: (error) => {
    onLogoutVoiceCallback?.();
    onLogoutNotesCallback?.();
    disconnectSocket();
    clearSession();
    clearLocalConversationSecrets();
    clearAllDMStorage();
    set({
      serverUrl: null,
      serverInfo: null,
      token: null,
      syncKey: null,
      user: null,
      isAuthenticated: false,
      centralRegPending: null,
      error: error ?? 'Your CatRealm session expired. Please log in again.',
      loading: false,
    });
    onLogoutCallback?.(true);
  },

  disconnect: () => {
    set({
      serverUrl: null,
      serverInfo: null,
      token: null,
      syncKey: null,
      user: null,
      isAuthenticated: false,
      centralRegPending: null,
      error: null,
      loading: false,
    });
    clearSession();
  },
}));
