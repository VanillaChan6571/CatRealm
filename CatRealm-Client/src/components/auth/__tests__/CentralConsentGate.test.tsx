import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: { user: { id: 'alice' } as { id: string } | null, logout: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: typeof h.state) => unknown) => selector(h.state),
    { getState: () => h.state },
  ),
}));
vi.mock('../../../lib/authApi', () => ({
  createAuthenticatedApi: () => ({ get: h.get, post: h.post }),
}));
import { CentralConsentGate } from '../CentralConsentGate';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const POLICY_PROMPT = /Please review the current policies/;

function renderGate() {
  return render(<CentralConsentGate><div>App shell</div></CentralConsentGate>);
}

describe('CentralConsentGate while checking consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    h.state = { user: { id: 'alice' }, logout: vi.fn() };
  });
  afterEach(() => cleanup());

  it('shows neither the policy prompt nor the app before the first answer', async () => {
    const pending = deferred<{ data: { required: boolean } }>();
    h.get.mockReturnValue(pending.promise);
    renderGate();
    expect(screen.queryByText(POLICY_PROMPT)).toBeNull();
    expect(screen.queryByText('App shell')).toBeNull();

    await act(async () => pending.resolve({ data: { required: false } }));
    expect(screen.getByText('App shell')).toBeTruthy();
  });

  it('shows the app right away for an account that already accepted on this device', async () => {
    h.get.mockResolvedValueOnce({ data: { required: false } });
    const first = renderGate();
    await act(async () => {});
    first.unmount();

    const pending = deferred<{ data: { required: boolean } }>();
    h.get.mockReturnValue(pending.promise);
    renderGate();
    expect(screen.getByText('App shell')).toBeTruthy();
    expect(screen.queryByText(POLICY_PROMPT)).toBeNull();

    // The server still decides: a new requirement brings the prompt back.
    await act(async () => pending.resolve({ data: { required: true } }));
    expect(screen.getByText(POLICY_PROMPT)).toBeTruthy();
    expect(screen.queryByText('App shell')).toBeNull();
  });

  it('does not reuse another account\'s acceptance', async () => {
    h.get.mockResolvedValueOnce({ data: { required: false } });
    const first = renderGate();
    await act(async () => {});
    first.unmount();

    h.state = { user: { id: 'bob' }, logout: vi.fn() };
    h.get.mockReturnValue(new Promise(() => {}));
    renderGate();
    expect(screen.queryByText('App shell')).toBeNull();
    expect(screen.queryByText(POLICY_PROMPT)).toBeNull();
  });

  it('shows the prompt with Retry when the check fails', async () => {
    const pending = deferred<{ data: { required: boolean } }>();
    h.get.mockReturnValue(pending.promise);
    renderGate();
    await act(async () => pending.reject(new Error('offline')));
    expect(screen.getByText(POLICY_PROMPT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
