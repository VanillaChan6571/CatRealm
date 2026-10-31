/**
 * Ref-counted LiveKit audio session for React Native.
 *
 * @livekit/react-native needs an AudioSession started for remote audio to route
 * correctly — without it, a second remote audio track (screen-share audio while
 * in voice) does not play. We start a session while any LiveKit room
 * (voice / call / theater) is connected and stop it once the last one leaves.
 *
 * We intentionally do NOT pin the iOS AVAudioSession category/mode — forcing it
 * overrides the WebRTC voice-processing unit and disables hardware echo
 * cancellation (feedback loop). Let @livekit/react-native manage the category.
 *
 * NOTE: notification sounds (expo-audio) must NOT call setAudioModeAsync while
 * this session is active — that deactivates the WebRTC session and kills audio.
 * See notificationSounds.ts ensureAudioConfig().
 */
import { createAudioSessionManager } from './audioSessionManager';
import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';

function livekit(): any {
  return require('@livekit/react-native');
}

const manager = createAudioSessionManager(
  async () => {
    const { AudioSession, AndroidAudioTypePresets } = livekit();
    await AudioSession.configureAudio({
      android: { audioTypeOptions: AndroidAudioTypePresets.communication },
      ios: { defaultOutput: 'speaker' },
    });
    await AudioSession.startAudioSession();
  },
  async () => {
    const { AudioSession } = livekit();
    await AudioSession.stopAudioSession();
    // A watch-party video may still be playing after its voice room disconnects.
    // Restore playback ownership instead of leaving an inactive recording session.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    await setIsAudioActiveAsync(true);
  },
);

export async function acquireAudioSession(): Promise<void> {
  try { await manager.acquire(); } catch (error) { console.warn('[audioSession] failed to start', error); }
}

export async function releaseAudioSession(): Promise<void> {
  try { await manager.release(); } catch (error) { console.warn('[audioSession] failed to stop', error); }
}
