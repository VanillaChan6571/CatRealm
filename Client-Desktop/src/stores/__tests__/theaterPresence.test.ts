import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../lib/socket', () => ({ getSocket: () => null }));
vi.mock('../serverStore', () => ({ useServerStore: { getState: () => ({}) } }));
vi.mock('../authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 'desktop' } }) } }));
vi.mock('../settingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));
vi.mock('../uiStore', () => ({ useUIStore: { getState: () => ({}) } }));
vi.mock('../mediaStore', () => ({ useMediaStore: { getState: () => ({}) } }));
vi.mock('../../lib/notificationSounds', () => ({ playNotificationSound: vi.fn() }));
vi.mock('../../lib/realtimeReconnect', () => ({ clearRealtimeReconnectTarget: vi.fn(), getRealtimeReconnectTarget: () => null }));

import { useTheaterStore } from '../theaterStore';
import type { TheaterUser } from '../../types';

const viewer: TheaterUser = {
  id: 'mobile', username: 'Mobile viewer', avatar: null, roleColor: null,
  clientType: 'mobile', voiceConnected: false,
  cameraEnabled: false, micEnabled: false, deafened: false, muted: true,
};
beforeEach(() => {
  useTheaterStore.setState({ ...useTheaterStore.getInitialState(), activeChannelId: 'theater', selfUserId: 'desktop' });
});

it('keeps mobile voice presence through room snapshots and live updates in both desktop lists', () => {
  useTheaterStore.getState().handleRoomUsers({ channelId: 'theater', users: [viewer] });
  expect(useTheaterStore.getState().users[0]).toMatchObject({ clientType: 'mobile', voiceConnected: false });
  useTheaterStore.getState().handleUserState({ channelId: 'theater', userId: 'mobile', voiceConnected: true });
  expect(useTheaterStore.getState().users[0]).toMatchObject({ voiceConnected: true, micEnabled: false });
  expect(useTheaterStore.getState().roomUsersByChannel.theater[0].voiceConnected).toBe(true);
  useTheaterStore.getState().handleUserState({ channelId: 'theater', userId: 'mobile', voiceConnected: false, muted: true });
  expect(useTheaterStore.getState().users[0].voiceConnected).toBe(false);
  expect(useTheaterStore.getState().roomUsersByChannel.theater[0].voiceConnected).toBe(false);
});

it('updates sidebar presence when browsing a different channel without replacing the active theater', () => {
  useTheaterStore.getState().handleRoomUsers({ channelId: 'other-theater', users: [viewer] });
  expect(useTheaterStore.getState().users).toEqual([]);
  expect(useTheaterStore.getState().roomUsersByChannel['other-theater'][0]).toMatchObject({ clientType: 'mobile', voiceConnected: false });
});
