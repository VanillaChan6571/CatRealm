/**
 * Decides how a chat media URL is rendered and whether it opens in CatRealm's
 * media viewer. Shared by uploaded attachments, linked media URLs, forwarded
 * media and the viewer itself so they agree on what counts as a video.
 */
export type ChatMediaKind = 'image' | 'video' | 'audio';

/** Inline playback handed from a chat player to the viewer so expanding continues where it left off. */
export type MediaViewerPlayback = {
  startTime?: number;
  /** The inline player was playing: keep playing (with the sound state the user chose). */
  resume?: boolean;
  muted?: boolean;
};

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|apng|svg)(?:[?#].*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|m4v|webm|mov|ogv)(?:[?#].*)?$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|flac|opus|oga)(?:[?#].*)?$/i;

function urlPath(url: string): string {
  try {
    return new URL(url, 'https://catrealm.invalid').pathname;
  } catch {
    return url;
  }
}

/**
 * MIME type wins when it is specific. Wildcards such as `image/*` are a placeholder
 * callers use when they don't know the type, so they fall back to the file extension.
 */
export function getChatMediaKind(url: string | null | undefined, mime?: string | null): ChatMediaKind | null {
  const type = (mime ?? '').trim().toLowerCase();
  if (type && !type.endsWith('/*')) {
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('audio/')) return 'audio';
  }
  if (!url) return null;
  const path = urlPath(url);
  if (VIDEO_EXT_RE.test(path)) return 'video';
  if (IMAGE_EXT_RE.test(path)) return 'image';
  if (AUDIO_EXT_RE.test(path)) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  return null;
}

export function isChatVideo(url: string | null | undefined, mime?: string | null): boolean {
  return getChatMediaKind(url, mime) === 'video';
}

/** Viewer `type` for a URL opened without a known MIME type. */
export function viewerTypeForKind(kind: ChatMediaKind | null): string {
  if (kind === 'video') return 'video/*';
  if (kind === 'audio') return 'audio/*';
  return 'image/*';
}

export type ViewerVideoStart = {
  autoPlay: boolean;
  muted: boolean;
  startTime: number;
};

/**
 * How a video starts when the viewer shows it: continue an inline player the user
 * already had playing (keeping their sound choice); otherwise autoplay muted, or
 * not at all when "Disable Autoplay" is on. The viewer never starts sound by itself.
 */
export function getViewerVideoStart(
  playback: MediaViewerPlayback | null | undefined,
  disableAutoplay: boolean,
): ViewerVideoStart {
  const startTime = playback?.startTime && Number.isFinite(playback.startTime) && playback.startTime > 0
    ? playback.startTime
    : 0;
  if (playback?.resume) {
    return { autoPlay: true, muted: playback.muted ?? false, startTime };
  }
  // Muted only while autoplaying; a video the user starts by hand plays with sound.
  return { autoPlay: !disableAutoplay, muted: !disableAutoplay, startTime };
}

/** Player time readout, formatted like Theater's (m:ss, or h:mm:ss past an hour). */
export function formatVideoTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
