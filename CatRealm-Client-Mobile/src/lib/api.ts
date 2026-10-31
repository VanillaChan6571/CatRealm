/**
 * HTTP API client — mirrors `CatRealm-Client/src/lib/api.ts`.
 *
 * Two flavors:
 *   - `createApi(serverUrl?, token?)` — for talking to a CatRealm self-hosted
 *     server. Defaults to the active server from authStore.
 *   - `authApi` / `createAuthenticatedApi()` — for talking to the Central
 *     Auth Service (https://auth.catrealm.app by default).
 *
 * The web client switches token sources for central accounts so HTTP routes
 * resolve via the server-issued token rather than the central JWT. We keep
 * the same logic here so backend behavior is identical.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import Constants from 'expo-constants';
import { useAuthStore } from '@/stores/authStore';
import { getCentralDeviceHeadersForUser } from '@/lib/centralDeviceCredentials';
import { captureAccountSession } from './accountSession';

interface ActiveServerInfo {
  url: string;
  token: string;
}

let activeServerGetter: (() => ActiveServerInfo | null) | null = null;

export function setActiveServerGetter(getter: () => ActiveServerInfo | null) {
  activeServerGetter = getter;
}

function getClientHeaders() {
  return { 'X-CatRealm-Client': 'mobile' };
}

async function getCentralDeviceHeaders() {
  const user = useAuthStore.getState().user;
  if (user?.accountType !== 'central') return {};
  return getCentralDeviceHeadersForUser(user.id);
}

export function createApi(serverUrl?: string, token?: string): AxiosInstance {
  const authState = useAuthStore.getState();
  let url = serverUrl ?? authState.serverUrl ?? '';
  let tok = token;

  if (tok === undefined) {
    if (authState.user?.accountType === 'central') {
      // Central account: must use a server-specific token from serverStore
      if (activeServerGetter) {
        const active = activeServerGetter();
        if (active) {
          if (!serverUrl || serverUrl === active.url) {
            tok = active.token;
            if (!serverUrl) url = active.url;
          }
        }
      }
      // If we still don't have a server token, do NOT fallback to the central JWT.
      // Doing so would cause 401/403 errors on self-hosted servers.
    } else {
      // Local account: use the main token
      tok = authState.token ?? undefined;
    }
  }

  return axios.create({
    baseURL: url,
    headers: {
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...getClientHeaders(),
    },
    timeout: 15000,
  });
}

/** Convenience: a shorthand object for components that don't care about the instance. */
export const api = {
  get: async <T = unknown>(url: string, config?: any) => {
    try {
      return (await createApi().get<T>(url, config)).data;
    } catch (e) {
      if (__DEV__) console.warn(`[api.get] ${url} failed:`, e);
      throw e;
    }
  },
  post: async <T = unknown>(url: string, data?: unknown, config?: any) => {
    try {
      return (await createApi().post<T>(url, data, config)).data;
    } catch (e) {
      if (__DEV__) console.warn(`[api.post] ${url} failed:`, e);
      throw e;
    }
  },
  put: async <T = unknown>(url: string, data?: unknown, config?: any) => {
    try {
      return (await createApi().put<T>(url, data, config)).data;
    } catch (e) {
      if (__DEV__) console.warn(`[api.put] ${url} failed:`, e);
      throw e;
    }
  },
  patch: async <T = unknown>(url: string, data?: unknown, config?: any) => {
    try {
      return (await createApi().patch<T>(url, data, config)).data;
    } catch (e) {
      if (__DEV__) console.warn(`[api.patch] ${url} failed:`, e);
      throw e;
    }
  },
  delete: async <T = unknown>(url: string, config?: any) => {
    try {
      return (await createApi().delete<T>(url, config)).data;
    } catch (e) {
      if (__DEV__) console.warn(`[api.delete] ${url} failed:`, e);
      throw e;
    }
  },
};

// ── Central Auth API ─────────────────────────────────────────────────────────

export const DEFAULT_AUTH_BASE = 'https://auth.catrealm.app';

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function resolveAuthBase() {
  // Prefer EXPO_PUBLIC_AUTH_SERVER_URL, then app.json `extra.authServerUrl`,
  // then the production default. This matches how the web client resolves
  // VITE_AUTH_SERVER_URL.
  const fromEnv = process.env.EXPO_PUBLIC_AUTH_SERVER_URL;
  const fromExpoConfig = Constants.expoConfig?.extra?.authServerUrl as string | undefined;
  return normalizeBaseUrl(fromEnv || fromExpoConfig || DEFAULT_AUTH_BASE);
}

export const AUTH_BASE = resolveAuthBase();

function isTerminalAuthError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const axiosError = error as AxiosError<{ error?: string }>;
  if (axiosError.response?.status !== 401) return false;
  const message = String(axiosError.response?.data?.error ?? '').trim().toLowerCase();
  return message === 'invalid token' || message === 'no token' || message === 'account not found';
}

function isAuthKeyRotatedError(error: unknown): boolean {
  return axios.isAxiosError(error)
    && (error.response?.data as { code?: string } | undefined)?.code === 'AUTH_KEY_ROTATED';
}

let centralSessionVerificationPromise: Promise<{ valid: boolean; keyRotated: boolean }> | null = null;
let centralSessionVerificationToken: string | null = null;

function getRequestBearerToken(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const headers = error.config?.headers;
  const authorization = typeof headers?.get === 'function'
    ? headers.get('Authorization')
    : (headers?.Authorization ?? headers?.authorization);
  if (typeof authorization !== 'string') return null;
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1] ?? null;
}

async function verifyCentralSessionStillValid(token: string, userId: string): Promise<{ valid: boolean; keyRotated: boolean }> {
  try {
    await axios.get(`${AUTH_BASE}/api/profile/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...getClientHeaders(),
        ...await getCentralDeviceHeadersForUser(userId),
      },
      timeout: 10000,
    });
    return { valid: true, keyRotated: false };
  } catch (error) {
    return { valid: !isTerminalAuthError(error), keyRotated: isAuthKeyRotatedError(error) };
  }
}

export async function confirmOrExpireCentralSession(error?: unknown) {
  const state = useAuthStore.getState();
  if (state.user?.accountType !== 'central' || !state.token) return;
  if (error && !isTerminalAuthError(error)) return;
  const failedToken = getRequestBearerToken(error);
  if (failedToken && failedToken !== state.token) return;

  if (!centralSessionVerificationPromise || centralSessionVerificationToken !== state.token) {
    centralSessionVerificationToken = state.token;
    const task = verifyCentralSessionStillValid(state.token, state.user.id).finally(() => {
      if (centralSessionVerificationPromise === task) {
        centralSessionVerificationPromise = null;
        centralSessionVerificationToken = null;
      }
    });
    centralSessionVerificationPromise = task;
  }

  const check = await centralSessionVerificationPromise;
  if (check && !check.valid) {
    const current = useAuthStore.getState();
    if (current.user?.id !== state.user.id || current.token !== state.token) return;
    const keyRotated = check.keyRotated || isAuthKeyRotatedError(error);
    useAuthStore.getState().expireCentralSession(keyRotated ? 'key_rotated' : null);
  }
}

function attachAuthInterceptors(instance: AxiosInstance, session?: ReturnType<typeof captureAccountSession>): AxiosInstance {
  instance.interceptors.request.use(async (config) => {
    if (new URL(config.url || '/', config.baseURL || AUTH_BASE).origin !== new URL(AUTH_BASE).origin) {
      throw new axios.CanceledError('Central credentials cannot be sent to another origin');
    }
    if (session && !session.isCurrent()) throw new axios.CanceledError('Account changed');
    const deviceHeaders = await getCentralDeviceHeaders();
    if (session && !session.isCurrent()) throw new axios.CanceledError('Account changed');
    config.headers = config.headers ?? {};
    for (const [key, value] of Object.entries(deviceHeaders)) {
      config.headers[key] = value;
    }
    return config;
  });
  instance.interceptors.response.use(
    (response) => {
      if (session && !session.isCurrent()) throw new axios.CanceledError('Account changed');
      return response;
    },
    async (error) => {
      try {
        if (!session || session.isCurrent()) await confirmOrExpireCentralSession(error);
      } catch (e) {
        if (__DEV__) console.warn('Error in auth interceptor confirmOrExpireCentralSession:', e);
      }
      return Promise.reject(error);
    },
  );
  return instance;
}

export const authApi = attachAuthInterceptors(
  axios.create({
    baseURL: AUTH_BASE,
    headers: getClientHeaders(),
  }),
);

export function createAuthenticatedApi(): AxiosInstance {
  const session = captureAccountSession();
  const token = session.token;
  return attachAuthInterceptors(
    axios.create({
      baseURL: AUTH_BASE,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...getClientHeaders(),
      },
    }), session,
  );
}
