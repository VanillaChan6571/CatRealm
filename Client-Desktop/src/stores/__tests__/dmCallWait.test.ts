import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 'self' } }) } }));
vi.mock('../settingsStore', () => ({ useSettingsStore: { getState: () => ({}) }, registerOnAudioSettingsChanged: vi.fn(), registerOnNoiseGateThresholdChanged: vi.fn() }));
vi.mock('../mediaStore', () => ({ useMediaStore: { getState: () => ({}) }, registerOnCallMediaReplaced: vi.fn() }));
vi.mock('../../lib/notificationSounds', () => ({ playNotificationSound: vi.fn() }));

import { useCallStore } from '../callStore';

const activeCall = {
  callId: 'call-1', conversationId: 'dm-1', otherUserId: 'peer', otherUsername: 'Peer', otherAvatar: null,
  mediaType: 'audio' as const, status: 'active' as const, startedAt: Date.now(), isInitiator: true,
  privacyMode: false, otherConnected: true, otherSharingScreen: true, otherVideoEnabled: true,
};

beforeEach(() => useCallStore.setState({ ...useCallStore.getInitialState(), activeDMCall: { ...activeCall } }));

it('keeps the call and controls available while the peer is away, then marks them rejoined', async () => {
  useCallStore.getState().handleDMParticipantLeft({ callId: 'call-1', userId: 'peer' });
  expect(useCallStore.getState().activeDMCall).toMatchObject({ callId: 'call-1', otherConnected: false, otherSharingScreen: false, otherVideoEnabled: false });
  expect(useCallStore.getState().lastEndedDMCall).toBeNull();

  await useCallStore.getState().handleDMParticipantJoined({ callId: 'call-1', userId: 'peer' });
  expect(useCallStore.getState().activeDMCall).toMatchObject({ callId: 'call-1', otherConnected: true });
});

it('does not auto rejoin after this user has left', async () => {
  useCallStore.setState({ activeDMCall: null, lastEndedDMCall: {
    callId: 'call-1', conversationId: 'dm-1', otherUserId: 'peer', otherUsername: 'Peer', otherAvatar: null,
    mediaType: 'audio', endedAt: Date.now(),
  } });
  await useCallStore.getState().handleDMParticipantJoined({ callId: 'call-1', userId: 'peer' });
  expect(useCallStore.getState().activeDMCall).toBeNull();
  expect(useCallStore.getState().lastEndedDMCall?.callId).toBe('call-1');
});
