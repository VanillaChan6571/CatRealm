import { useEffect, useState } from 'react';
import { Image, Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Pressable } from './Pressable';
import type { NowPlaying } from '@/types';

function formatElapsedClock(startedAt: number | null, nowMs: number): string | null {
  if (!startedAt || !Number.isFinite(startedAt) || startedAt <= 0) return null;
  const totalSeconds = Math.max(0, Math.floor(nowMs / 1000) - startedAt);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Last.fm "Now Playing" card on profiles; styled like the game activity card. */
export function NowPlayingCard({ track }: { track: NowPlaying }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [failedArtUrl, setFailedArtUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!track.startedAt) return;
    const timer = globalThis.setInterval(() => setNowMs(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, [track.startedAt]);

  const elapsed = formatElapsedClock(track.startedAt, nowMs);
  const showArt = !!track.imageUrl && track.imageUrl !== failedArtUrl;
  const trackUrl = track.url;

  return (
    <Pressable
      haptic={!!trackUrl}
      disabled={!trackUrl}
      onPress={() => { if (trackUrl) void Linking.openURL(trackUrl); }}
      accessibilityRole={trackUrl ? 'link' : undefined}
      style={{
        marginTop: theme.spacing.md,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: theme.colors.accent + '55',
        backgroundColor: theme.colors.bgElev1,
        padding: theme.spacing.md,
        shadowColor: theme.colors.accent,
        shadowOpacity: 0.28,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 10,
      }}
    >
      <View style={{ marginBottom: 10 }}>
        <Text variant="caption" style={{ color: theme.colors.accent, fontWeight: '700', letterSpacing: 1.2 }}>
          {t('lastfm.cardBadge').toUpperCase()}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 14,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.bgElev2,
          }}
        >
          {showArt ? (
            <Image
              source={{ uri: track.imageUrl ?? undefined }}
              style={{ width: 72, height: 72 }}
              resizeMode="cover"
              onError={() => setFailedArtUrl(track.imageUrl)}
            />
          ) : (
            <Text variant="title">🎵</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subtitle" numberOfLines={1}>{track.title}</Text>
          <Text variant="bodySmall" color={theme.colors.text2} numberOfLines={1}>
            {t('lastfm.byArtist', { artist: track.artist })}
          </Text>
          {track.album ? (
            <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>
              {t('lastfm.onAlbum', { album: track.album })}
            </Text>
          ) : null}
          <Text variant="caption" style={{ marginTop: 4, color: theme.colors.accent }}>
            🎵 {elapsed ?? t('lastfm.listeningNow')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
