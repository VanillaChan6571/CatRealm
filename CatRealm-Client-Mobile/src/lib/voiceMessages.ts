import { RecordingPresets, type RecordingOptions } from 'expo-audio';
import type { MessageAttachment } from '@/types';

/**
 * Mobile records AAC in an MP4 container: the one format AVPlayer (iOS), ExoPlayer (Android)
 * and Chromium (desktop) all play. Desktop records WebM/Opus, which AVPlayer cannot open.
 */
export const VOICE_RECORDING_MIME = 'audio/mp4';
export const VOICE_RECORDING_NAME = 'voice-message.m4a';

export const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
};

// Same choices as desktop VoiceAutoDeleteModal; null = keep forever.
export const VOICE_EXPIRY_OPTIONS: ReadonlyArray<{ labelKey: string; ms: number | null }> = [
  { labelKey: 'chat.voiceExpiry30m', ms: 30 * 60 * 1000 },
  { labelKey: 'chat.voiceExpiry3d', ms: 3 * 86400 * 1000 },
  { labelKey: 'chat.voiceExpiry7d', ms: 7 * 86400 * 1000 },
  { labelKey: 'chat.voiceExpiry14d', ms: 14 * 86400 * 1000 },
  { labelKey: 'chat.voiceExpiry30d', ms: 30 * 86400 * 1000 },
  { labelKey: 'chat.voiceExpiryNever', ms: null },
];

const AUDIO_EXT_RE = /\.(m4a|mp3|wav|aac|opus|oga|flac)(\?|$)/i;
const VOICE_NAME_RE = /^voice-message\./i;

/** Audio wins over the video regex: `voice-message.webm` must not reach the video player. */
export function isAudioAttachment(att: Pick<MessageAttachment, 'url' | 'mime' | 'type' | 'name'>): boolean {
  const mime = att.mime ?? att.type ?? '';
  if (mime.startsWith('audio/')) return true;
  if (mime) return false;
  return VOICE_NAME_RE.test(att.name ?? '') || AUDIO_EXT_RE.test(att.url ?? '');
}

const IOS_UNPLAYABLE_MIME_RE = /^audio\/(webm|ogg)/i;
const IOS_UNPLAYABLE_EXT_RE = /\.(webm|ogg|oga|opus)(\?|$)/i;

/** AVPlayer has no WebM/Ogg demuxer (Apple DTS confirms), so these never load on iOS. */
export function canPlayVoiceOn(os: string, mime: string | null, url: string): boolean {
  if (os !== 'ios') return true;
  if (mime && IOS_UNPLAYABLE_MIME_RE.test(mime)) return false;
  return !IOS_UNPLAYABLE_EXT_RE.test(url);
}

export function formatVoiceDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
