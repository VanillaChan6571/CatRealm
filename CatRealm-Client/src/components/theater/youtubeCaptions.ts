// Caption control for the Theater YouTube embed. These use the IFrame player's
// `captions` module options (getOption/setOption), which YouTube exposes once
// the module is loaded but does not formally document.

export interface YouTubeCaptionTrack {
  languageCode: string;
  /** 'asr' for auto-generated captions, '' (or absent) for uploaded ones. */
  kind?: string;
  displayName?: string;
  languageName?: string;
}

interface CaptionCapablePlayer {
  getOption?: (module: string, option: string) => unknown;
  setOption?: (module: string, option: string, value: unknown) => void;
  loadModule?: (module: string) => void;
}

export function getCaptionTracks(player: CaptionCapablePlayer | null | undefined): YouTubeCaptionTrack[] {
  try {
    const list = player?.getOption?.('captions', 'tracklist');
    if (!Array.isArray(list)) return [];
    return list.filter(
      (track): track is YouTubeCaptionTrack => !!track && typeof track.languageCode === 'string' && track.languageCode.length > 0,
    );
  } catch {
    return [];
  }
}

function baseLanguage(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/, 1)[0];
}

/**
 * The track to show for `language`: an uploaded track in that language first,
 * then an auto-generated one. Null when the video has no track in it.
 */
export function pickCaptionTrack(tracks: readonly YouTubeCaptionTrack[], language: string): YouTubeCaptionTrack | null {
  const want = baseLanguage(language);
  const matches = tracks.filter((track) => baseLanguage(track.languageCode) === want);
  return matches.find((track) => track.kind !== 'asr') ?? matches[0] ?? null;
}

/** Show `track`, or hide captions when it's null. */
export function setYouTubeCaptions(player: CaptionCapablePlayer | null | undefined, track: YouTubeCaptionTrack | null) {
  try {
    if (track) {
      player?.setOption?.('captions', 'track', track);
    } else {
      player?.setOption?.('captions', 'track', {});
    }
  } catch {
    // The captions module isn't loaded or the player is gone.
  }
}

export function captionTrackLabel(track: YouTubeCaptionTrack): string {
  return track.displayName || track.languageName || track.languageCode;
}
