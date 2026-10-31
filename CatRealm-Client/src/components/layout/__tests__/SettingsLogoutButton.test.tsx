import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openModal = vi.hoisted(() => vi.fn());
vi.mock('../../../stores/uiStore', () => ({
  useUIStore: (select: (s: { openModal: typeof openModal }) => unknown) => select({ openModal }),
}));
import { SettingsLogoutButton } from '../SettingsLogoutButton';

describe('settings button secret logout', () => {
  beforeEach(() => { vi.useFakeTimers(); openModal.mockClear(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('opens voice settings by default', () => {
    render(<SettingsLogoutButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Voice Settings' }));
    expect(openModal).toHaveBeenCalledWith('profileSettings', { initialTab: 'voice' });
  });

  it('becomes Log Out after holding Shift over it for two seconds, until the pointer leaves', () => {
    render(<SettingsLogoutButton />);
    const button = screen.getByRole('button');
    fireEvent.mouseEnter(button);
    fireEvent.keyDown(window, { key: 'Shift' });
    act(() => { vi.advanceTimersByTime(1999); });
    expect(button.getAttribute('aria-label')).toBe('Voice Settings');
    act(() => { vi.advanceTimersByTime(1); });
    expect(button.getAttribute('aria-label')).toBe('Log Out');
    fireEvent.keyUp(window, { key: 'Shift' });
    fireEvent.click(button);
    expect(openModal).toHaveBeenCalledWith('confirmLogout');
    fireEvent.mouseLeave(button);
    expect(button.getAttribute('aria-label')).toBe('Voice Settings');
  });

  it('cancels when Shift is released early', () => {
    render(<SettingsLogoutButton />);
    const button = screen.getByRole('button');
    fireEvent.mouseEnter(button, { shiftKey: true });
    act(() => { vi.advanceTimersByTime(1500); });
    fireEvent.keyUp(window, { key: 'Shift' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(button.getAttribute('aria-label')).toBe('Voice Settings');
  });
});
