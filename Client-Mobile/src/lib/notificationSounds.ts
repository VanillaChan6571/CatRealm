import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
import { trackMemoryResource } from './memoryResources';

export type SoundType =
  | 'message-in-channel'
  | 'message-in-server'
  | 'message-mention'
  | 'message-everyone'
  | 'dm-incoming-call'
  | 'dm-outgoing-call'
  | 'dm-message-current'
  | 'dm-message-other'
  | 'voice-deafen'
  | 'voice-undeafen'
  | 'voice-mute'
  | 'voice-unmute'
  | 'voice-ptt-activate'
  | 'voice-ptt-deactivate'
  | 'voice-user-joined'
  | 'voice-user-left'
  | 'voice-user-moved'
  | 'screenshare-go-live'
  | 'screenshare-user-join'
  | 'screenshare-user-left'
  | 'screenshare-ended'
  | 'screenshare-stopped'
  | 'rtc-failed'
  | 'rtc-reconnecting'
  | 'ui-button-click'
  | 'hourly-beep'
  | 'ambience'
  | 'channel-created'
  | 'category-created'
  | 'uploading-attachment'
  | 'typing'
  | 'send-message'
  | 'channel-deleted'
  | 'category-deleted'
  | 'deleting-message'
  | 'editing-message';

const SOUND_ASSETS_DEFAULT: Record<SoundType, number> = {
  'message-in-channel': require('../../assets/sounds/Desktop-Web-Android/New-Message-in-Channel.ogg'),
  'message-in-server': require('../../assets/sounds/Desktop-Web-Android/New-Message.ogg'),
  'message-mention': require('../../assets/sounds/Desktop-Web-Android/New-Message.ogg'),
  'message-everyone': require('../../assets/sounds/Desktop-Web-Android/New-Message.ogg'),
  'dm-incoming-call': require('../../assets/sounds/Desktop-Web-Android/Incoming-Call.ogg'),
  'dm-outgoing-call': require('../../assets/sounds/Desktop-Web-Android/Outgoing-Call.ogg'),
  'dm-message-current': require('../../assets/sounds/Desktop-Web-Android/New-Message-in-current-DM.ogg'),
  'dm-message-other': require('../../assets/sounds/Desktop-Web-Android/New-Message-from-a-DM.ogg'),
  'voice-deafen': require('../../assets/sounds/Desktop-Web-Android/Deafen.ogg'),
  'voice-undeafen': require('../../assets/sounds/Desktop-Web-Android/Undeafen.ogg'),
  'voice-mute': require('../../assets/sounds/Desktop-Web-Android/Mute.ogg'),
  'voice-unmute': require('../../assets/sounds/Desktop-Web-Android/Unmute.ogg'),
  'voice-ptt-activate': require('../../assets/sounds/Desktop-Web-Android/Push-To-Talk-Activate.ogg'),
  'voice-ptt-deactivate': require('../../assets/sounds/Desktop-Web-Android/Push-To-Talk-Deactivate.ogg'),
  'voice-user-joined': require('../../assets/sounds/Desktop-Web-Android/User-Joined.ogg'),
  'voice-user-left': require('../../assets/sounds/Desktop-Web-Android/User-Left.ogg'),
  'voice-user-moved': require('../../assets/sounds/Desktop-Web-Android/User-Moved.ogg'),
  'screenshare-go-live': require('../../assets/sounds/Desktop-Web-Android/User-Joined.ogg'),
  'screenshare-user-join': require('../../assets/sounds/Desktop-Web-Android/Screenshare-User-Joined-Stream.ogg'),
  'screenshare-user-left': require('../../assets/sounds/Desktop-Web-Android/Screenshare-User-Left-Stream.ogg'),
  'screenshare-ended': require('../../assets/sounds/Desktop-Web-Android/User-Left.ogg'),
  'screenshare-stopped': require('../../assets/sounds/Desktop-Web-Android/User-Left.ogg'),
  'rtc-failed': require('../../assets/sounds/Desktop-Web-Android/User-Left.ogg'),
  'rtc-reconnecting': require('../../assets/sounds/Desktop-Web-Android/User-Joined.ogg'),
  'ui-button-click': require('../../assets/sounds/Desktop-Web-Android/Push-To-Talk-Activate.ogg'),
  'hourly-beep': require('../../assets/sounds/Desktop-Web-Android/New-Message.ogg'),
  ambience: require('../../assets/sounds/Desktop-Web-Android/Ambience-Setting-Sounds.ogg'),
  'channel-created': require('../../assets/sounds/Desktop-Web-Android/User-Joined.ogg'),
  'category-created': require('../../assets/sounds/Desktop-Web-Android/User-Joined.ogg'),
  'uploading-attachment': require('../../assets/sounds/Desktop-Web-Android/Push-To-Talk-Activate.ogg'),
  typing: require('../../assets/sounds/Desktop-Web-Android/Push-To-Talk-Activate.ogg'),
  'send-message': require('../../assets/sounds/Desktop-Web-Android/Push-To-Talk-Deactivate.ogg'),
  'channel-deleted': require('../../assets/sounds/Desktop-Web-Android/User-Left.ogg'),
  'category-deleted': require('../../assets/sounds/Desktop-Web-Android/User-Left.ogg'),
  'deleting-message': require('../../assets/sounds/Desktop-Web-Android/User-Left.ogg'),
  'editing-message': require('../../assets/sounds/Desktop-Web-Android/Push-To-Talk-Activate.ogg'),
};

const SOUND_ASSETS_IOS: Record<SoundType, number> = {
  'message-in-channel': require('../../assets/sounds/iOS/New-Message-in-Channel.mp3'),
  'message-in-server': require('../../assets/sounds/iOS/New-Message.mp3'),
  'message-mention': require('../../assets/sounds/iOS/New-Message.mp3'),
  'message-everyone': require('../../assets/sounds/iOS/New-Message.mp3'),
  'dm-incoming-call': require('../../assets/sounds/iOS/Incoming-Call.mp3'),
  'dm-outgoing-call': require('../../assets/sounds/iOS/Outgoing-Call.mp3'),
  'dm-message-current': require('../../assets/sounds/iOS/New-Message-in-current-DM.mp3'),
  'dm-message-other': require('../../assets/sounds/iOS/New-Message-from-a-DM.mp3'),
  'voice-deafen': require('../../assets/sounds/iOS/Deafen.mp3'),
  'voice-undeafen': require('../../assets/sounds/iOS/Undeafen.mp3'),
  'voice-mute': require('../../assets/sounds/iOS/Mute.mp3'),
  'voice-unmute': require('../../assets/sounds/iOS/Unmute.mp3'),
  'voice-ptt-activate': require('../../assets/sounds/iOS/Push-To-Talk-Activate.mp3'),
  'voice-ptt-deactivate': require('../../assets/sounds/iOS/Push-To-Talk-Deactivate.mp3'),
  'voice-user-joined': require('../../assets/sounds/iOS/User-Joined.mp3'),
  'voice-user-left': require('../../assets/sounds/iOS/User-Left.mp3'),
  'voice-user-moved': require('../../assets/sounds/iOS/User-Moved.mp3'),
  'screenshare-go-live': require('../../assets/sounds/iOS/User-Joined.mp3'),
  'screenshare-user-join': require('../../assets/sounds/iOS/Screenshare-User-Joined-Stream.mp3'),
  'screenshare-user-left': require('../../assets/sounds/iOS/Screenshare-User-Left-Stream.mp3'),
  'screenshare-ended': require('../../assets/sounds/iOS/User-Left.mp3'),
  'screenshare-stopped': require('../../assets/sounds/iOS/User-Left.mp3'),
  'rtc-failed': require('../../assets/sounds/iOS/User-Left.mp3'),
  'rtc-reconnecting': require('../../assets/sounds/iOS/User-Joined.mp3'),
  'ui-button-click': require('../../assets/sounds/iOS/Push-To-Talk-Activate.mp3'),
  'hourly-beep': require('../../assets/sounds/iOS/New-Message.mp3'),
  ambience: require('../../assets/sounds/iOS/Ambience-Setting-Sounds.mp3'),
  'channel-created': require('../../assets/sounds/iOS/User-Joined.mp3'),
  'category-created': require('../../assets/sounds/iOS/User-Joined.mp3'),
  'uploading-attachment': require('../../assets/sounds/iOS/Push-To-Talk-Activate.mp3'),
  typing: require('../../assets/sounds/iOS/Push-To-Talk-Activate.mp3'),
  'send-message': require('../../assets/sounds/iOS/Push-To-Talk-Deactivate.mp3'),
  'channel-deleted': require('../../assets/sounds/iOS/User-Left.mp3'),
  'category-deleted': require('../../assets/sounds/iOS/User-Left.mp3'),
  'deleting-message': require('../../assets/sounds/iOS/User-Left.mp3'),
  'editing-message': require('../../assets/sounds/iOS/Push-To-Talk-Activate.mp3'),
};

const SOUND_ASSETS = Platform.OS === 'ios' ? SOUND_ASSETS_IOS : SOUND_ASSETS_DEFAULT;
type LoopOwner = { player: AudioPlayer | null; stop: () => void };
const ACTIVE_LOOPING_SOUNDS = new Map<SoundType, LoopOwner>();
// Weak keys do not extend the lifetime of any native player.
const playerMetrics = new WeakMap<AudioPlayer, ReturnType<typeof trackMemoryResource>>();

function disposeAudioPlayer(player: AudioPlayer) {
  // remove() unregisters the iOS player; release() tears down the shared native
  // object/observers now, even if a stale stop closure survives until JS GC.
  try { player.pause(); } catch { /* still release after a native error */ }
  try { player.remove(); } catch { /* release is the final safety net */ }
  try { player.release(); } catch { /* already invalidated by native teardown */ }
  playerMetrics.get(player)?.dispose();
  playerMetrics.delete(player);
}

const normalizedVolume = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100)) : 0;

// Sounds suppressed while a voice or theater session is active.
// Voice events, call alerts, and user-action sounds are intentionally excluded.
const MEDIA_SESSION_SUPPRESSED: ReadonlySet<SoundType> = new Set<SoundType>([
  'message-in-channel',
  'message-in-server',
  'message-mention',
  'message-everyone',
  'dm-message-current',
  'dm-message-other',
  'voice-deafen',
  'voice-undeafen',
  'voice-mute',
  'voice-unmute',
  'voice-ptt-activate',
  'voice-ptt-deactivate',
  'channel-created',
  'category-created',
  'channel-deleted',
  'category-deleted',
  'hourly-beep',
]);

let voiceSessionActive = false;
let theaterSessionActive = false;

export function setVoiceSessionActive(active: boolean) { voiceSessionActive = active; }
export function setTheaterSessionActive(active: boolean) { theaterSessionActive = active; }
/** True while LiveKit owns the audio session; callers must not touch setAudioModeAsync then. */
export function isMediaSessionActive() { return voiceSessionActive || theaterSessionActive; }

let audioConfigured = false;

async function ensureAudioConfig() {
  if (audioConfigured) return;
  // While a LiveKit voice/theater session owns the iOS audio session, do NOT
  // call setAudioModeAsync — it deactivates the WebRTC session and kills voice
  // and screen-share audio (e.g. tapping mute plays a sound effect mid-call).
  // Sound effects still play through the active session.
  if (voiceSessionActive || theaterSessionActive) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
    audioConfigured = true;
  } catch (err) {
    console.warn('[notificationSounds] ensureAudioConfig failed', err);
  }
}

export async function playNotificationSound(type: SoundType, volumePercent: number) {
  if ((voiceSessionActive || theaterSessionActive) && MEDIA_SESSION_SUPPRESSED.has(type)) return;
  const source = SOUND_ASSETS[type];
  if (!source) return;
  const volume = normalizedVolume(volumePercent);
  if (volume <= 0) return;

  let player: AudioPlayer | null = null;
  const dispose = () => {
    const current = player;
    player = null;
    if (current) disposeAudioPlayer(current);
  };
  try {
    await ensureAudioConfig();
    // A notification may finish after a voice/theater session has started.
    // It must never deactivate the app-wide iOS session on completion/pause.
    player = createAudioPlayer(source, { keepAudioSessionActive: true });
    if (__DEV__) playerMetrics.set(player, trackMemoryResource('notificationOneShots'));
    player.volume = volume;
    player.loop = false;
    player.play();
    // Short notification sounds; schedule cleanup after a safe upper bound
    setTimeout(dispose, 10_000);
  } catch (err) {
    dispose();
    console.warn('[notificationSounds] playNotificationSound failed', type, err);
  }
}

export async function startLoopingNotificationSound(type: SoundType, volumePercent: number, options: { signal?: AbortSignal } = {}): Promise<() => Promise<void>> {
  const source = SOUND_ASSETS[type];
  const { signal } = options;
  if (!source || signal?.aborted) return async () => {};
  // Reserve ownership before awaiting audio configuration. A replacement or
  // abort can cancel a pending start before it allocates any native player.
  ACTIVE_LOOPING_SOUNDS.get(type)?.stop();
  let disposed = false;
  const owner: LoopOwner = { player: null, stop: () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', owner.stop);
    if (ACTIVE_LOOPING_SOUNDS.get(type) === owner) ACTIVE_LOOPING_SOUNDS.delete(type);
    const current = owner.player;
    owner.player = null;
    if (current) disposeAudioPlayer(current);
  } };
  ACTIVE_LOOPING_SOUNDS.set(type, owner);
  signal?.addEventListener('abort', owner.stop, { once: true });
  const stop = async () => owner.stop();

  try {
    await ensureAudioConfig();
    if (disposed || signal?.aborted) { owner.stop(); return stop; }
    const player = createAudioPlayer(source, { keepAudioSessionActive: true });
    owner.player = player;
    if (__DEV__) playerMetrics.set(player, trackMemoryResource('notificationLoops'));
    // A zero-volume loop remains owned so raising its slider works in place.
    player.volume = normalizedVolume(volumePercent);
    player.loop = true;
    player.play();
  } catch (err) {
    owner.stop();
    console.warn('[notificationSounds] startLoopingNotificationSound failed', type, err);
  }
  return stop;
}

// Adjust the volume of an already-running looping sound in place. Lets callers
// (e.g. the ambience slider) reflect volume changes live without tearing down
// and restarting the loop, which would otherwise restart playback from the top.
export function setLoopingNotificationSoundVolume(type: SoundType, volumePercent: number) {
  const player = ACTIVE_LOOPING_SOUNDS.get(type)?.player;
  if (!player) return;
  player.volume = normalizedVolume(volumePercent);
}
