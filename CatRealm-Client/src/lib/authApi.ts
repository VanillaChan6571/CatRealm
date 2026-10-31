import axios from 'axios';
import { useAuthStore } from '../stores/authStore';
import { decodeToken, saveSession } from '../utils/token';
import { getCentralDeviceHeaders } from './centralDeviceCredentials';
export { getCentralDeviceHeaders } from './centralDeviceCredentials';

export const DEFAULT_AUTH_BASE = 'https://auth.catrealm.app';

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function resolveAuthBase() {
  const configured = typeof import.meta !== 'undefined'
    ? import.meta.env.VITE_AUTH_SERVER_URL
    : undefined;
  return normalizeBaseUrl(configured || DEFAULT_AUTH_BASE);
}

export const AUTH_BASE = resolveAuthBase();

export function getDesktopClientHeaders() {
  if (typeof window !== 'undefined' && window.electron) {
    return { 'X-CatRealm-Client': 'desktop' };
  }
  return {};
}

function isTerminalAuthError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.response?.status !== 401) return false;

  const message = String(error.response?.data?.error ?? '').trim().toLowerCase();
  return (
    message === 'invalid token'
    || message === 'no token'
    || message === 'account not found'
  );
}

let centralSessionVerificationPromise: Promise<{ valid: boolean; keyRotated: boolean }> | null = null;
let lastCentralSessionVerificationAt = 0;
const CENTRAL_SESSION_VERIFY_COOLDOWN_MS = 5000;
const CENTRAL_TOKEN_REFRESH_WINDOW_MS = 48 * 60 * 60 * 1000;

let centralTokenRefreshPromise: Promise<string | null> | null = null;
let centralTokenRefreshOwner: string | null = null;

function getTokenExpiryMs(token: string | null): number | null {
  if (!token) return null;
  const payload = decodeToken(token);
  const exp = typeof payload?.exp === 'number' ? payload.exp : null;
  return exp ? exp * 1000 : null;
}

function getRequestBearerToken(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const headers = error.config?.headers as any;
  const auth = typeof headers?.get === 'function'
    ? headers.get('Authorization')
    : (headers?.Authorization ?? headers?.authorization);
  if (typeof auth !== 'string') return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function persistFreshCentralToken(token: string) {
  const state = useAuthStore.getState();
  const user = state.user;
  if (user?.accountType !== 'central') return;
  useAuthStore.setState({ token });
  saveSession(token, null, user, state.syncKey);
}

async function refreshCentralSession(): Promise<string | null> {
  const state = useAuthStore.getState();
  if (state.user?.accountType !== 'central' || !state.token) return null;

  try {
    const res = await axios.post(`${AUTH_BASE}/api/login/refresh`, null, {
      headers: {
        Authorization: `Bearer ${state.token}`,
        ...getDesktopClientHeaders(),
        ...getCentralDeviceHeaders(),
      },
      timeout: 10000,
    });
    const nextToken = typeof res.data?.token === 'string' ? res.data.token : null;
    if (!nextToken) return null;
    const current = useAuthStore.getState();
    if (current.user?.id !== state.user.id || current.user?.accountType !== 'central' || current.token !== state.token) return null;
    persistFreshCentralToken(nextToken);
    return nextToken;
  } catch {
    return null;
  }
}

export async function refreshCentralSessionIfNeeded(options: { force?: boolean } = {}): Promise<string | null> {
  const state = useAuthStore.getState();
  if (state.user?.accountType !== 'central' || !state.token) return null;

  if (!options.force) {
    const expiresAt = getTokenExpiryMs(state.token);
    if (!expiresAt || expiresAt - Date.now() > CENTRAL_TOKEN_REFRESH_WINDOW_MS) {
      return state.token;
    }
  }

  if (!centralTokenRefreshPromise || centralTokenRefreshOwner !== state.token) {
    centralTokenRefreshOwner = state.token;
    const task = refreshCentralSession()
      .finally(() => {
        if (centralTokenRefreshPromise === task) centralTokenRefreshPromise = null;
      });
    centralTokenRefreshPromise = task;
  }
  return centralTokenRefreshPromise;
}

function isAuthKeyRotatedError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.data?.code === 'AUTH_KEY_ROTATED';
}

const CENTRAL_KEY_ROTATED_MESSAGE =
  'Central has restarted with a new security key — all users have been logged out for safety. Please log in again.';

type CentralSessionCheck = { valid: boolean; keyRotated: boolean };

async function verifyCentralSessionStillValid(): Promise<CentralSessionCheck> {
  const state = useAuthStore.getState();
  if (state.user?.accountType !== 'central' || !state.token) return { valid: false, keyRotated: false };

  try {
    await axios.get(`${AUTH_BASE}/api/profile/me`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
        ...getDesktopClientHeaders(),
        ...getCentralDeviceHeaders(),
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

  const now = Date.now();
  if (!centralSessionVerificationPromise || now - lastCentralSessionVerificationAt > CENTRAL_SESSION_VERIFY_COOLDOWN_MS) {
    lastCentralSessionVerificationAt = now;
    centralSessionVerificationPromise = verifyCentralSessionStillValid()
      .finally(() => {
        centralSessionVerificationPromise = null;
      });
  }

  const check = await centralSessionVerificationPromise;
  if (check && !check.valid) {
    const keyRotated = check.keyRotated || isAuthKeyRotatedError(error);
    useAuthStore.getState().expireCentralSession(keyRotated ? CENTRAL_KEY_ROTATED_MESSAGE : undefined);
  }
}

function attachAuthInterceptors(instance: ReturnType<typeof axios.create>, accountId?: string) {
  instance.interceptors.request.use(async (config) => {
    if (new URL(config.url || '/', config.baseURL || AUTH_BASE).origin !== new URL(AUTH_BASE).origin) {
      throw new axios.CanceledError('Central credentials cannot be sent to another origin');
    }
    const checkAccount = () => {
      if (accountId && (useAuthStore.getState().user?.id !== accountId || useAuthStore.getState().user?.accountType !== 'central')) {
        throw new axios.CanceledError('Account changed before request was sent');
      }
    };
    checkAccount();
    const nextToken = await refreshCentralSessionIfNeeded();
    checkAccount();
    config.headers = config.headers ?? {};
    if (nextToken) {
      config.headers.Authorization = `Bearer ${nextToken}`;
    }
    const deviceHeaders = getCentralDeviceHeaders();
    for (const [key, value] of Object.entries(deviceHeaders)) {
      config.headers[key] = value;
    }
    return config;
  });
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      await confirmOrExpireCentralSession(error);
      return Promise.reject(error);
    }
  );
  return instance;
}

export const authApi = attachAuthInterceptors(axios.create({
  baseURL: AUTH_BASE,
  headers: getDesktopClientHeaders(),
}));

export function createAuthenticatedApi() {
  const { token, user } = useAuthStore.getState();
  return attachAuthInterceptors(axios.create({
    baseURL: AUTH_BASE,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...getDesktopClientHeaders(),
    },
  }), user?.id);
}
