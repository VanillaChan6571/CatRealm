import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), start: vi.fn() }));
vi.mock('@hcaptcha/react-hcaptcha', () => ({ default: () => <div data-testid="inline-captcha" /> }));
vi.mock('../../../lib/authApi', () => ({ authApi: { get: h.get } }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({
    centralRegisterStart: h.start,
    centralRegisterConfirm: vi.fn(),
    centralRegPending: null,
    clearCentralReg: vi.fn(),
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
}));
import { CentralRegisterForm } from '../CentralRegisterForm';

describe('desktop registration captcha', () => {
  afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'electron'); vi.clearAllMocks(); });

  it('uses a hosted verification window and submits its token to Central', async () => {
    Object.defineProperty(window, 'electron', { configurable: true, value: { openCaptchaWindow: h.open } });
    h.get.mockResolvedValue({ data: { enabled: true, siteKey: 'public-site-key' } });
    h.open.mockResolvedValue({ ok: true, token: 'captcha-token' });
    render(<CentralRegisterForm onRegistered={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByTestId('inline-captcha')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify with hCaptcha' })); });
    expect(h.open).toHaveBeenCalledWith('public-site-key');

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Alice' } });
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(h.start).toHaveBeenCalledWith('Alice', 'captcha-token');
  });
});
