import { useVoiceStore } from '../stores/voiceStore';
import { useAuthStore } from '../stores/authStore';
import { persistRealtimeReconnectTarget } from './realtimeReconnect';

/**
 * Relaunch the desktop client, rejoining the current voice channel afterwards.
 * app.exit() skips beforeunload, so the voice rejoin target is persisted
 * explicitly (same fields App.tsx persists on reload).
 */
export async function restartAndReconnectClient() {
  const voiceState = useVoiceStore.getState();
  const channelId = voiceState.activeChannelId ?? voiceState.pendingChannelId;
  if (channelId && voiceState.voiceServerUrl) {
    persistRealtimeReconnectTarget({
      kind: 'voice',
      serverUrl: voiceState.voiceServerUrl,
      channelId,
      channelName: voiceState.voiceChannelName ?? null,
      userId: useAuthStore.getState().user?.id ?? null,
    });
  }
  await window.electron?.relaunchApp?.();
}
