import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fps: vi.fn(), hardware: vi.fn(), backend: vi.fn() }));
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: (selector: any) => selector({
  screenshareFps: 60, screenshareResolution: 1080, screenshareAudio: true,
  screenshareQualityPreset: 'quality', screenshareDegradationPreference: 'maintain-framerate',
  screenshareCodecPreference: 'auto', screenShareEncoderBackend: 'auto',
  screenShareDesktopCaptureMode: 'auto', screenShareNativeProfile: 'high',
  screenshareWizardCompletedAt: 1, screenShareNativeWhipEnabled: false,
  setScreenshareFps: mocks.fps, setScreenShareHardwareEncoding: mocks.hardware,
  setScreenShareEncoderBackend: mocks.backend,
}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../lib/clientRestart', () => ({ restartAndReconnectClient: vi.fn() }));
vi.mock('../../../lib/screenshareSettingsSync', () => ({ useScreenshareSettingsSync: vi.fn() }));
vi.mock('../ScreenshareWizardModal', () => ({ ScreenshareWizardModal: () => null }));
import { ScreenshareSettingsPanel } from '../ScreenshareSettingsPanel';

const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron');
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const diagnostics = deferred(), support = deferred(), gpus = deferred();
  Object.defineProperty(window, 'electron', { configurable: true, value: {
    getScreenShareVideoEncoding: vi.fn(() => diagnostics.promise),
    getNativeWhipPublisherSupport: vi.fn(() => support.promise),
    listScreenShareGpus: vi.fn(() => gpus.promise),
  } });
  return { diagnostics, support, gpus };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  if (originalElectron) Object.defineProperty(window, 'electron', originalElectron);
  else Reflect.deleteProperty(window, 'electron');
});

it('keeps controls usable while discovery is pending and clears status only when all probes settle', async () => {
  const probes = setup();
  render(<ScreenshareSettingsPanel />);
  expect(screen.getByRole('status').textContent).toContain('Detecting');
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '48' } });
  expect(mocks.fps).toHaveBeenCalledWith(48);
  await act(async () => {
    probes.diagnostics.resolve({ hardwareEncoding: true, encoderBackend: 'auto' });
    probes.support.resolve({ ok: true });
  });
  expect(screen.getByRole('status')).toBeTruthy();
  await act(async () => probes.gpus.resolve({ gpus: [] }));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
});

it('failed discovery does not leave the panel stuck loading', async () => {
  const probes = setup();
  render(<ScreenshareSettingsPanel />);
  await act(async () => {
    probes.diagnostics.reject(new Error('GPU unavailable'));
    probes.support.reject(new Error('Runtime missing'));
    probes.gpus.reject(new Error('Driver timeout'));
  });
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '24' } });
  expect(mocks.fps).toHaveBeenCalledWith(24);
});

it('ignores late discovery results after leaving the tab', async () => {
  const probes = setup();
  const view = render(<ScreenshareSettingsPanel />);
  view.unmount();
  await act(async () => {
    probes.diagnostics.resolve({ hardwareEncoding: true, encoderBackend: 'd3d11' });
    probes.support.resolve({ ok: true });
    probes.gpus.resolve({ gpus: [] });
  });
  expect(mocks.hardware).not.toHaveBeenCalled();
  expect(mocks.backend).not.toHaveBeenCalled();
});
