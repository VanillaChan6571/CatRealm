// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { ScreenCapturePermissionNotice } from '../ScreenCapturePermissionNotice';

function setElectron(value: unknown) {
  Object.defineProperty(window, 'electron', { value, configurable: true });
}

describe('ScreenCapturePermissionNotice', () => {
  afterEach(() => {
    cleanup();
    setElectron(undefined);
  });

  it('explains the missing permission and opens System Settings', async () => {
    const openScreenCaptureSettings = vi.fn().mockResolvedValue(true);
    setElectron({ getScreenCaptureAccess: () => Promise.resolve({ status: 'denied' }), openScreenCaptureSettings });
    render(<ScreenCapturePermissionNotice />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Screen Recording'));
    fireEvent.click(screen.getByRole('button'));
    expect(openScreenCaptureSettings).toHaveBeenCalledOnce();
  });

  it('stays hidden once access is granted', async () => {
    const getScreenCaptureAccess = vi.fn().mockResolvedValue({ status: 'granted' });
    setElectron({ getScreenCaptureAccess });
    const { container } = render(<ScreenCapturePermissionNotice />);
    await waitFor(() => expect(getScreenCaptureAccess).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
