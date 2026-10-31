import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: { completed: true } })));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (s: { user: { id: string; accountType: string } }) => unknown) => select({ user: { id: 'u1', accountType: 'central' } }),
}));
vi.mock('../../../lib/authApi', () => ({ createAuthenticatedApi: () => ({ post, get: vi.fn() }) }));
import { AppTour } from '../AppTour';
import { AppTourOffer } from '../AppTourOffer';
import { TOUR_STEPS } from '../tourSteps';
import { useUIStore } from '../../../stores/uiStore';
import { decideAppTour, hasDeviceSeenAppTour, useAppTourStore } from '../../../lib/appTour';
import i18n from '../../../i18n';

function anchor(name: string, onClick?: () => void) {
  const el = document.createElement('button');
  el.dataset.tour = name;
  el.getBoundingClientRect = () => ({ left: 10, top: 10, right: 60, bottom: 40, width: 50, height: 30, x: 10, y: 10, toJSON: () => ({}) });
  if (onClick) el.addEventListener('click', onClick);
  document.body.appendChild(el);
  return el;
}

const allAnchors = () => TOUR_STEPS.forEach((s) => { if (s.target) anchor(s.target); });

async function next() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^(Next|Done)$/ })); });
}

describe('app tour', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
    useAppTourStore.setState({ open: false });
    useUIStore.setState({ activeModal: null });
    post.mockClear();
  });
  afterEach(() => cleanup());

  function start() {
    render(<AppTour />);
    act(() => useAppTourStore.getState().start());
  }

  it('takes the user home first, then opens Discover for them', async () => {
    const home = vi.fn();
    const discover = vi.fn();
    anchor('home', home);
    anchor('home-nav');
    anchor('discover', discover);
    start();
    expect(home).toHaveBeenCalled();
    await next(); // Home
    await next(); // Friends and notes
    await next(); // Discover
    expect(screen.getByText('Discover servers')).toBeTruthy();
    expect(discover).toHaveBeenCalled();
  });

  it('uses the active app language for tour copy and controls', async () => {
    start();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ru' } });
    expect(screen.getByText('Добро пожаловать в CatRealm')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Далее' })).toBeTruthy();
  });

  it('skips steps whose anchor is not on screen, and steps back', async () => {
    anchor('home');
    anchor('add-server');
    start();
    await next();
    expect(screen.getByText('Home')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back' })); });
    expect(screen.getByText(TOUR_STEPS[0].title)).toBeTruthy();
  });

  it('waits for the user to open Settings, then walks the profile with a "Will do later" option', async () => {
    allAnchors();
    start();
    for (let i = 0; i < 8; i++) await next();
    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    await act(async () => { useUIStore.setState({ activeModal: 'profileSettings' }); });
    expect(await screen.findByText('Main Profile')).toBeTruthy();
    await next();
    expect(screen.getByText('Add a profile picture')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Will do later' })); });
    expect(screen.getByText('Add a banner')).toBeTruthy();
  });

  it('steps aside while an image is being cropped', async () => {
    allAnchors();
    start();
    const crop = document.createElement('div');
    crop.setAttribute('data-tour-pause', '');
    document.body.appendChild(crop);
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    expect(screen.queryByText(TOUR_STEPS[0].title)).toBeNull();
    crop.remove();
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    expect(screen.getByText(TOUR_STEPS[0].title)).toBeTruthy();
  });

  it('marks both the account and this device when skipped, with the button or Escape', () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(useAppTourStore.getState().open).toBe(false);
    expect(hasDeviceSeenAppTour('u1')).toBe(true);
    expect(hasDeviceSeenAppTour('u2')).toBe(false);
    expect(post).toHaveBeenCalledWith('/api/app-tour');

    localStorage.clear();
    act(() => useAppTourStore.getState().start());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(hasDeviceSeenAppTour('u1')).toBe(true);
  });

  it('offers the tour on a new device: Skip marks the device, Take the tour starts it', () => {
    render(<AppTourOffer />);
    act(() => useUIStore.setState({ activeModal: 'appTourOffer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(hasDeviceSeenAppTour('u1')).toBe(true);
    expect(useAppTourStore.getState().open).toBe(false);

    act(() => useUIStore.setState({ activeModal: 'appTourOffer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }));
    expect(useUIStore.getState().activeModal).toBeNull();
    expect(useAppTourStore.getState().open).toBe(true);
  });

  it('lets the account decide first, then the device', () => {
    expect(decideAppTour(false, false)).toBe('tour');
    expect(decideAppTour(false, true)).toBe('tour'); // a stale device flag can't hide it
    expect(decideAppTour(true, false)).toBe('offer');
    expect(decideAppTour(true, true)).toBeNull();
  });
});
