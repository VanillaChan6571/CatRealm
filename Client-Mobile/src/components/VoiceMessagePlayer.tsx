import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type GestureResponderEvent } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioSource } from 'expo-audio';
import { Mic, Pause, Play } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { isMediaSessionActive } from '@/lib/notificationSounds';
import { canPlayVoiceOn, formatVoiceDuration } from '@/lib/voiceMessages';

/** Playback-only session, matching what audioSession.ts restores after a call. */
export async function enterVoicePlaybackMode(): Promise<void> {
  if (isMediaSessionActive()) return; // LiveKit owns the session; changing it kills call audio.
  try {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
  } catch (err) {
    console.warn('[VoiceMessagePlayer] setAudioModeAsync failed', err);
  }
}

// Same auth rules as ChatVideo: realm-hosted files get that realm's bearer token.
function useAuthedAudioSource(url: string, serverUrl?: string | null): AudioSource {
  const authServerUrl = useAuthStore((s) => s.serverUrl);
  const authToken = useAuthStore((s) => s.token);
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const servers = useServerStore((s) => s.servers);
  return useMemo(() => {
    const lower = url.toLowerCase();
    const isServerHosted = (serverUrl && lower.includes(serverUrl.toLowerCase()))
      || (authServerUrl && lower.includes(authServerUrl.toLowerCase()));
    if (!isServerHosted) return { uri: url };
    const token = isCentral
      ? servers.find((server) => lower.includes(server.url.toLowerCase()))?.token ?? authToken
      : authToken;
    return { uri: url, headers: { 'X-CatRealm-Client': 'mobile', Authorization: `Bearer ${token || ''}` } };
  }, [url, serverUrl, authServerUrl, authToken, isCentral, servers]);
}

type VoiceMessagePlayerProps = {
  url: string;
  mime?: string | null;
  serverUrl?: string | null;
};

export function VoiceMessagePlayer({ url, mime = null, serverUrl }: VoiceMessagePlayerProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  if (!canPlayVoiceOn(Platform.OS, mime, url)) {
    return (
      <View style={[styles.wrap, { backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft }]}>
        <Mic size={16} color={theme.colors.text3} />
        <Text variant="caption" color={theme.colors.text3} style={{ flex: 1 }}>{t('chat.voiceUnsupportedIos')}</Text>
        <Pressable onPress={() => void Linking.openURL(url)} hitSlop={8}>
          <Text variant="caption" color={theme.colors.accent}>{t('chat.voiceOpenExternally')}</Text>
        </Pressable>
      </View>
    );
  }
  return <VoicePlayerControls url={url} serverUrl={serverUrl} />;
}

/** Also used by the composer to preview a local recording (file:// URI, no auth). */
export function VoicePlayerControls({ url, serverUrl, bare = false }: { url: string; serverUrl?: string | null; bare?: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const source = useAuthedAudioSource(url, serverUrl);
  const player = useAudioPlayer(source, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);

  const duration = status.duration > 0 ? status.duration : 0;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  // AVPlayer parks at the end; rewind so the next tap replays from the start.
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  const toggle = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    await enterVoicePlaybackMode();
    if (duration > 0 && status.currentTime >= duration - 0.05) await player.seekTo(0);
    player.play();
  };

  const seek = (event: GestureResponderEvent) => {
    if (!duration || !trackWidth) return;
    const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / trackWidth));
    void player.seekTo(ratio * duration);
  };

  const Icon = status.playing ? Pause : Play;
  return (
    <View style={bare ? styles.bare : [styles.wrap, { backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? t('chat.voicePause') : t('chat.voicePlay')}
        onPress={() => void toggle()}
        disabled={!status.isLoaded}
        style={[styles.playBtn, { backgroundColor: theme.colors.accent, opacity: status.isLoaded ? 1 : 0.5 }]}
      >
        <Icon size={14} color={theme.colors.textOnAccent} fill={theme.colors.textOnAccent} />
      </Pressable>
      <Pressable
        style={styles.trackHit}
        onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}
        onPress={seek}
      >
        <View style={[styles.track, { backgroundColor: theme.colors.lineSoft }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: theme.colors.accent }]} />
        </View>
      </Pressable>
      <Text variant="caption" color={theme.colors.text3} style={styles.time}>
        {status.playing || status.currentTime > 0
          ? formatVoiceDuration(status.currentTime)
          : formatVoiceDuration(duration)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 300,
  },
  bare: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  trackHit: { flex: 1, paddingVertical: 10 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  time: { minWidth: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
