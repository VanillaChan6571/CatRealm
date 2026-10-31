import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: { user: null as { id: string } | null, token: null as string | null, loading: false, error: null as string | null },
  post: vi.fn(), open: vi.fn(), login: vi.fn(), loginWithToken: vi.fn(), clearError: vi.fn(), setState: vi.fn(),
}));
vi.mock('axios', () => ({ default: { post: h.post, isAxiosError: () => false } }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign(() => ({ ...h.state, centralLogin: h.login, centralLoginWithToken: h.loginWithToken, clearError: h.clearError }),
    { getState: () => h.state, setState: h.setState }),
}));
vi.mock('../../../lib/authApi', () => ({ AUTH_BASE: 'https://auth.catrealm.app', getDesktopClientHeaders: () => ({}),
  getCentralDeviceHeaders: () => ({ 'X-CatRealm-Device-Id': 'synthetic-device', 'X-CatRealm-Device-Secret': 'synthetic-independent-secret' }),
}));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn() }));
import { CentralLoginForm } from '../CentralLoginForm';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const result = { data: { status: 'complete', token: 'alice-session', user: { id: 'alice', username: 'Alice' }, syncKey: 'alice-sync' } };

describe('desktop passkey login ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    h.state = { user: null, token: null, loading: false, error: null };
    Object.defineProperty(window, 'electron', { configurable: true, value: { openPasskeyWindow: h.open } });
    h.open.mockResolvedValue({ ok: true });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(window, 'electron'); });

  async function beginLogin() {
    const pending = deferred<typeof result>();
    h.post.mockImplementation((url: string) => {
      if (url.endsWith('/available')) return Promise.resolve({ data: { available: true } });
      if (url.endsWith('/start')) return Promise.resolve({ data: { flowId: 'flow', pollSecret: 'private-poll', url: '/webauthn/login/flow?secret=ceremony-only' } });
      if (url.endsWith('/status')) return pending.promise;
      throw new Error('Unexpected endpoint');
    });
    const view = render(<CentralLoginForm />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Alice' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use passkey / security key' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(h.open).toHaveBeenCalledWith('https://auth.catrealm.app/webauthn/login/flow?secret=ceremony-only');
    expect(h.post.mock.calls.some(([url]) => url.endsWith('/status'))).toBe(true);
    return { ...view, pending };
  }

  it('completes the current attempt using the app-only polling result', async () => {
    const { pending } = await beginLogin();
    await act(async () => { pending.resolve(result); });
    expect(h.loginWithToken).toHaveBeenCalledWith('alice-session', 'alice', 'Alice', 'alice-sync');
    expect(h.open.mock.calls[0][0]).not.toContain('private-poll');
  });

  it('cannot replace a different account signed in while the popup was open', async () => {
    const { pending } = await beginLogin();
    h.state = { ...h.state, user: { id: 'bob' }, token: 'bob-session' };
    await act(async () => { pending.resolve(result); });
    expect(h.loginWithToken).not.toHaveBeenCalled();
    expect(h.setState).not.toHaveBeenCalled();
  });

  it('aborts polling and ignores a late response after the login form unmounts', async () => {
    const { pending, unmount } = await beginLogin();
    const statusRequest = h.post.mock.calls.find(([url]) => url.endsWith('/status'));
    unmount();
    expect(statusRequest?.[2].signal.aborted).toBe(true);
    await act(async () => { pending.resolve(result); });
    expect(h.loginWithToken).not.toHaveBeenCalled();
    expect(h.setState).not.toHaveBeenCalled();
  });
});

describe('switch-account mode', () => {
  beforeEach(() => {
    vi.useRealTimers(); vi.clearAllMocks();
    h.state = { user: { id: 'bob' }, token: 'bob-session', loading: false, error: null };
  });
  afterEach(() => { cleanup(); });

  function submit(onSession: () => void) {
    render(<CentralLoginForm initialUsername="Alice" onSession={onSession} />);
    fireEvent.change(screen.getByLabelText('Authenticator Code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
  }

  it('hands the new session back without replacing the signed-in one', async () => {
    h.post.mockResolvedValue({ data: { token: 'alice-session', user: { id: 'alice', username: 'Alice' }, syncKey: 'alice-sync' } });
    const onSession = vi.fn();
    submit(onSession);
    await act(async () => {});
    expect(h.post).toHaveBeenCalledWith('https://auth.catrealm.app/api/login', { username: 'Alice', totpCode: '123456' }, expect.anything());
    expect(onSession).toHaveBeenCalledWith({ token: 'alice-session', user: { id: 'alice', username: 'Alice' }, syncKey: 'alice-sync' });
    expect(h.login).not.toHaveBeenCalled();
    expect(h.loginWithToken).not.toHaveBeenCalled();
  });

  it('keeps a failed attempt local to the form', async () => {
    h.post.mockRejectedValue(new Error('nope'));
    const onSession = vi.fn();
    submit(onSession);
    await act(async () => {});
    expect(await screen.findByText('Invalid username or 2FA code')).toBeTruthy();
    expect(onSession).not.toHaveBeenCalled();
    expect(h.setState).not.toHaveBeenCalled();
  });
});
