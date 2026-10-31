// Simple sound player for notification sounds
// Each sound type maps to a specific audio file
export type SoundType =
  // Chat Sounds
  | 'message-in-channel'
  | 'message-in-server'
  | 'message-mention'
  | 'message-everyone'
  // DM Sounds
  | 'dm-incoming-call'
  | 'dm-outgoing-call'
  | 'dm-message-current'
  | 'dm-message-other'
  // Voice Chat Sounds
  | 'voice-deafen'
  | 'voice-undeafen'
  | 'voice-mute'
  | 'voice-unmute'
  | 'voice-ptt-activate'
  | 'voice-ptt-deactivate'
  // Voice Chat Users
  | 'voice-user-joined'
  | 'voice-user-left'
  | 'voice-user-moved'
  // Extra Voice Chat Sounds
  | 'screenshare-go-live'
  | 'screenshare-user-join'
  | 'screenshare-user-left'
  | 'screenshare-ended'
  | 'screenshare-stopped'
  | 'rtc-failed'
  | 'rtc-reconnecting'
  // Very Extra Sounds
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

export const SOUND_FILES: Record<SoundType, string> = {
  // Chat Sounds
  'message-in-channel': 'New Message in Channel',
  'message-in-server': 'New Message',
  'message-mention': 'New Message', // Reusing - add dedicated file later if needed
  'message-everyone': 'New Message', // Reusing - add dedicated file later if needed

  // DM Sounds
  'dm-incoming-call': 'Incoming Call',
  'dm-outgoing-call': 'Outgoing Call',
  'dm-message-current': 'New Message in current DM',
  'dm-message-other': 'New Message from a DM',

  // Voice Chat Sounds
  'voice-deafen': 'Deafen',
  'voice-undeafen': 'Undeafen',
  'voice-mute': 'Mute',
  'voice-unmute': 'Unmute',
  'voice-ptt-activate': 'Push To Talk Activate',
  'voice-ptt-deactivate': 'Push To Talk Deactivate',

  // Voice Chat Users
  'voice-user-joined': 'User Joined',
  'voice-user-left': 'User Left',
  'voice-user-moved': 'User Moved',

  // Extra Voice Chat Sounds
  'screenshare-go-live': 'User Joined',
  'screenshare-user-join': 'Screenshare User Joined Stream',
  'screenshare-user-left': 'Screenshare User Left Stream',
  'screenshare-ended': 'User Left',
  'screenshare-stopped': 'User Left',
  'rtc-failed': 'User Left',
  'rtc-reconnecting': 'User Joined',

  // Very Extra Sounds (using similar sounds as placeholders - add dedicated files later)
  'ui-button-click': 'Push To Talk Activate',
  'hourly-beep': 'New Message',
  'ambience': 'Ambience Setting Sounds',
  'channel-created': 'User Joined',
  'category-created': 'User Joined',
  'uploading-attachment': 'Push To Talk Activate',
  'typing': 'Push To Talk Activate',
  'send-message': 'Push To Talk Deactivate',
  'channel-deleted': 'User Left',
  'category-deleted': 'User Left',
  'deleting-message': 'User Left',
  'editing-message': 'Push To Talk Activate',
};

const bundledSounds = import.meta.glob('../assets/sounds/**/*.{ogg,mp3}', { eager: true, import: 'default' }) as Record<string, string>;
const BUNDLED_SOUNDS_BY_RELATIVE_PATH = Object.fromEntries(
  Object.entries(bundledSounds).map(([path, url]) => {
    const rel = path.replace('../assets/sounds/', '');
    return [rel, url];
  })
) as Record<string, string>;
const warnedMissingTypes = new Set<SoundType>();
let audioUnlocked = false;
let unlockListenersAttached = false;
let queuedSound: { type: SoundType; volumePercent: number } | null = null;
const SOUND_DEBUG_KEY = 'catrealm:sound-debug';

function isSoundDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SOUND_DEBUG_KEY) === '1';
}

function debugSoundLog(...args: unknown[]) {
  if (!isSoundDebugEnabled()) return;
  console.log('[SoundDebug]', ...args);
}

function unlockAudio() {
  if (typeof window === 'undefined') return;
  audioUnlocked = true;
  unlockListenersAttached = false;
  debugSoundLog('Audio unlocked by user gesture');
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
  if (queuedSound) {
    const next = queuedSound;
    queuedSound = null;
    debugSoundLog('Playing queued sound after unlock', next);
    playNotificationSound(next.type, next.volumePercent);
  }
}

// Only used once the browser has actually refused playback: Electron and Tauri
// allow autoplay, so sounds must not wait for a click there (e.g. after the app
// relaunches minimized, nobody clicks until the window is reopened).
function queueUntilUserGesture(type: SoundType, volumePercent: number) {
  audioUnlocked = false;
  queuedSound = { type, volumePercent };
  debugSoundLog('Autoplay blocked, queued sound until a user gesture', queuedSound);
  if (unlockListenersAttached || typeof window === 'undefined') return;
  unlockListenersAttached = true;
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
}

export function getSoundCandidates(type: SoundType): string[] {
  const fileBase = SOUND_FILES[type];
  if (!fileBase) return [];

  const bundledDesktop = BUNDLED_SOUNDS_BY_RELATIVE_PATH[`Desktop-Web-Android/${fileBase}.ogg`];
  const bundledIos = BUNDLED_SOUNDS_BY_RELATIVE_PATH[`iOS/${fileBase}.mp3`];
  // Prefer MP3 for web reliability, keep OGG as fallback.
  const ordered = [bundledIos, bundledDesktop];
  return ordered.filter(Boolean) as string[];
}

export function playNotificationSound(type: SoundType, volumePercent: number) {
  if (typeof window === 'undefined') return;
  const volume = Math.max(0, Math.min(1, volumePercent / 100));
  if (volume === 0) return;
  const candidates = getSoundCandidates(type);
  debugSoundLog('Play request', { type, volumePercent, volume, candidates });
  const tryPlay = (index: number) => {
    if (index >= candidates.length) {
      if (!warnedMissingTypes.has(type)) {
        warnedMissingTypes.add(type);
        console.warn('[Sound] Failed to play notification sound:', type);
      }
      debugSoundLog('No playable candidates remained', { type });
      return;
    }
    const url = candidates[index];
    const audio = new Audio(url);
    audio.volume = volume;
    audio.addEventListener(
      'error',
      () => {
        debugSoundLog('Candidate failed', {
          type,
          url,
          code: audio.error?.code,
          message: audio.error?.message,
        });
        tryPlay(index + 1);
      },
      { once: true },
    );
    audio
      .play()
      .then(() => {
        audioUnlocked = true;
        debugSoundLog('Candidate played', { type, url });
      })
      .catch((err) => {
        debugSoundLog('play() rejected', { type, url, err });
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          queueUntilUserGesture(type, volumePercent);
          return;
        }
        tryPlay(index + 1);
      });
  };
  tryPlay(0);
}

if (typeof window !== 'undefined') {
  const w = window as Window & {
    __catrealmSoundDebug?: {
      enable: () => void;
      disable: () => void;
      test: (type?: SoundType, volumePercent?: number) => void;
      beep: (frequencyHz?: number, ms?: number, volume?: number) => void;
      state: () => { unlocked: boolean; listenersAttached: boolean; queued: typeof queuedSound };
    };
  };
  if (!w.__catrealmSoundDebug) {
    w.__catrealmSoundDebug = {
      enable: () => localStorage.setItem(SOUND_DEBUG_KEY, '1'),
      disable: () => localStorage.removeItem(SOUND_DEBUG_KEY),
      test: (type = 'message-in-channel', volumePercent = 60) =>
        playNotificationSound(type, volumePercent),
      beep: (frequencyHz = 440, ms = 400, volume = 0.1) => {
        const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) {
          console.warn('[SoundDebug] No AudioContext available');
          return;
        }
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequencyHz;
        gain.gain.value = Math.max(0, Math.min(1, volume));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        window.setTimeout(() => {
          osc.stop();
          void ctx.close();
        }, Math.max(50, ms));
      },
      state: () => ({ unlocked: audioUnlocked, listenersAttached: unlockListenersAttached, queued: queuedSound }),
    };
  }
}
