import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import { useVersionStore } from '../stores/versionStore';

interface ActiveServerInfo {
  url: string;
  token: string;
}

let activeServerGetter: (() => ActiveServerInfo | null) | null = null;

export function setActiveServerGetter(getter: () => ActiveServerInfo | null) {
  activeServerGetter = getter;
}

// Servers reject an expired JWT with 403 "Invalid or expired token" (not 401),
// so status alone cannot separate expiry from a permission denial — match the
// message. A client left idle past the token lifetime otherwise 403s on every
// request until it is restarted.
const EXPIRED_TOKEN_MESSAGE = /invalid or expired token|no token provided/i;

type ServerTokenRefresher = (serverUrl: string) => Promise<string | null>;
let serverTokenRefresher: ServerTokenRefresher | null = null;

export function setServerTokenRefresher(refresher: ServerTokenRefresher) {
  serverTokenRefresher = refresher;
}

type RetriableConfig = InternalAxiosRequestConfig & { __catrealmAuthRetried?: boolean };

function isExpiredTokenError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status !== 401 && status !== 403) return false;
  const message = (error.response?.data as { error?: unknown } | undefined)?.error;
  return typeof message === 'string' && EXPIRED_TOKEN_MESSAGE.test(message);
}

export function createApi(serverUrl?: string, token?: string) {
  const authState = useAuthStore.getState();
  let url = serverUrl ?? authState.serverUrl ?? '';
  let tok = token ?? (authState.user?.accountType === 'central' ? null : authState.token);

  // For central accounts, prefer the server-issued token over the central JWT
  // so that HTTP routes resolve the user via local payload.id (same as sockets).
  if (!token && authState.user?.accountType === 'central' && activeServerGetter) {
    const active = activeServerGetter();
    if (active) {
      if (!serverUrl) {
        // No explicit URL — use active server URL + token
        url = active.url;
        tok = active.token;
      } else if (serverUrl === active.url) {
        // Explicit URL matches active server — still use server-issued token
        tok = active.token;
      }
    }
  }

  if (authState.user?.accountType === 'central' && tok === authState.token) tok = null;

  const instance = axios.create({
    baseURL: url,
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
  });

  // Response interceptor to check server version
  instance.interceptors.response.use(
    (response) => {
      // Check for version header (only for central auth server)
      const serverVersion = response.headers['x-app-version'];
      if (serverVersion && authState.user?.accountType === 'central') {
        useVersionStore.getState().setServerVersion(serverVersion);
      }
      return response;
    },
    async (error) => {
      // An expired server token is recoverable for central accounts: mint a
      // fresh one from the central JWT and replay the request once. Anything
      // else (including a central token that has itself expired) falls through
      // to the caller.
      const config = error?.config as RetriableConfig | undefined;
      if (
        config &&
        !config.__catrealmAuthRetried &&
        serverTokenRefresher &&
        useAuthStore.getState().user?.accountType === 'central' &&
        isExpiredTokenError(error)
      ) {
        const targetUrl = config.baseURL || url;
        if (targetUrl) {
          const freshToken = await serverTokenRefresher(targetUrl).catch(() => null);
          if (freshToken) {
            config.__catrealmAuthRetried = true;
            config.headers.set('Authorization', `Bearer ${freshToken}`);
            return instance.request(config);
          }
        }
      }
      return Promise.reject(error);
    }
  );

  return instance;
}

// Helper object for components that need a simple API interface
export const api = {
  get: async (url: string) => {
    const instance = createApi();
    const response = await instance.get(url);
    return response.data;
  },
  post: async (url: string, data?: any) => {
    const instance = createApi();
    const response = await instance.post(url, data);
    return response.data;
  },
  put: async (url: string, data?: any) => {
    const instance = createApi();
    const response = await instance.put(url, data);
    return response.data;
  },
  delete: async (url: string) => {
    const instance = createApi();
    const response = await instance.delete(url);
    return response.data;
  },
  patch: async (url: string, data?: any) => {
    const instance = createApi();
    const response = await instance.patch(url, data);
    return response.data;
  },
};
