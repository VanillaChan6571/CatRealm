import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Send, Square, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { IconBtn } from './IconBtn';
import { Sheet } from './Sheet';
import { VoicePlayerControls, enterVoicePlaybackMode } from './VoiceMessagePlayer';
import { isMediaSessionActive } from '@/lib/notificationSounds';
import { VOICE_EXPIRY_OPTIONS, VOICE_RECORDING_OPTIONS, formatVoiceDuration } from '@/lib/voiceMessages';

type VoiceRecorderBarProps = {
  /** Fired with the local file URI once the user taps send on the preview. */
  onSubmit: (uri: string) => void;
  onCancel: () => void;
  busy?: boolean;
};

type Phase = 'starting' | 'recording' | 'review';

/** Tap-to-record bar that replaces the composer row (desktop VoiceMessageRecorder parity). */
export function VoiceRecorderBar({ onSubmit, onCancel, busy = false }: VoiceRecorderBarProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<Phase>('starting');
  const [uri, setUri] = useState<string | null>(null);
  const phaseRef = useRef<Phase>('starting');
  phaseRef.current = phase;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Switching the session to record mode mid-call would tear down LiveKit audio.
      if (isMediaSessionActive()) {
        Alert.alert(t('chat.voiceRecord'), t('chat.voiceInCall'));
        onCancel();
        return;
      }
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(t('chat.voiceRecord'), t('chat.voiceMicDenied'));
          onCancel();
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        setPhase('recording');
      } catch (err) {
        console.warn('[VoiceRecorderBar] start failed', err);
        Alert.alert(t('chat.voiceRecord'), t('chat.voiceRecordFailed'));
        onCancel();
      }
    })();
    return () => {
      cancelled = true;
      // Unmount mid-recording (navigation, cancel): stop the mic and leave record mode,
      // otherwise iOS keeps routing playback to the earpiece.
      // The hook may already have released the native recorder (which also stops it).
      if (phaseRef.current === 'recording') {
        try { void recorder.stop().catch(() => {}); } catch { /* already released */ }
      }
      void enterVoicePlaybackMode();
    };
    // Runs once per bar; the recorder is stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = async () => {
    try {
      await recorder.stop();
      await enterVoicePlaybackMode();
      const fileUri = recorder.uri ?? state.url;
      if (!fileUri) throw new Error('Recording produced no file');
      setUri(fileUri);
      setPhase('review');
    } catch (err) {
      console.warn('[VoiceRecorderBar] stop failed', err);
      Alert.alert(t('chat.voiceRecord'), t('chat.voiceRecordFailed'));
      onCancel();
    }
  };

  // metering is dBFS (-160..0); map the useful -50..0 range to a 0..1 level.
  const level = Math.max(0, Math.min(1, ((state.metering ?? -160) + 50) / 50));

  return (
    <View style={styles.row}>
      <IconBtn icon={X} accessibilityLabel={t('chat.voiceCancel')} onPress={onCancel} disabled={busy} />
      <View style={[styles.body, { backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft, borderRadius: theme.radius.lg }]}>
        {phase === 'review' && uri ? (
          <View style={{ flex: 1 }}>
            <VoicePlayerControls url={uri} bare />
          </View>
        ) : (
          <>
            <View style={[styles.dot, { backgroundColor: theme.colors.danger, opacity: phase === 'recording' ? 1 : 0.4 }]} />
            <Text variant="bodySmall" color={theme.colors.text2} style={styles.timer}>
              {formatVoiceDuration(state.durationMillis / 1000)}
            </Text>
            <View style={[styles.levelTrack, { backgroundColor: theme.colors.lineSoft }]}>
              <View style={[styles.levelFill, { width: `${level * 100}%`, backgroundColor: theme.colors.accent }]} />
            </View>
            <Text variant="caption" color={theme.colors.text3}>{t('chat.voiceRecording')}</Text>
          </>
        )}
      </View>
      {phase === 'review' ? (
        busy
          ? <View style={styles.busy}><ActivityIndicator color={theme.colors.accent} /></View>
          : <IconBtn icon={Send} accessibilityLabel={t('chat.voiceSend')} onPress={() => uri && onSubmit(uri)} />
      ) : (
        <IconBtn icon={Square} accessibilityLabel={t('chat.voiceStop')} onPress={() => void stop()} disabled={phase !== 'recording'} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  body: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  timer: { minWidth: 36, fontVariant: ['tabular-nums'] },
  levelTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  levelFill: { height: 4, borderRadius: 2 },
  busy: { width: 44, alignItems: 'center', justifyContent: 'center' },
  sheet: { paddingHorizontal: 16, paddingBottom: 8 },
  option: { paddingHorizontal: 12, paddingVertical: 10 },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  sheetBtn: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
});

type VoiceExpirySheetProps = {
  open: boolean;
  onCancel: () => void;
  /** Absolute expiry in ms (what realm `voice_expires_at` / Central `voiceExpiresAt` take), or null. */
  onConfirm: (expiresAt: number | null) => void;
};

/** Desktop VoiceAutoDeleteModal parity: pick an auto-delete window, then send. */
export function VoiceExpirySheet({ open, onCancel, onConfirm }: VoiceExpirySheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [selected, setSelected] = useState(VOICE_EXPIRY_OPTIONS.length - 1);
  return (
    <Sheet open={open} onClose={onCancel} maxHeightFraction={0.6}>
      <View style={styles.sheet}>
        <Text variant="subtitle" style={{ marginBottom: 8 }}>{t('chat.voiceAutoDeleteTitle')}</Text>
        {VOICE_EXPIRY_OPTIONS.map((option, index) => {
          const active = index === selected;
          return (
            <Pressable
              key={option.labelKey}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setSelected(index)}
              style={[styles.option, { borderRadius: theme.radius.md, backgroundColor: active ? theme.colors.accent : 'transparent' }]}
            >
              <Text variant="body" color={active ? theme.colors.textOnAccent : theme.colors.text}>{t(option.labelKey)}</Text>
            </Pressable>
          );
        })}
        <View style={styles.sheetActions}>
          <Pressable onPress={onCancel} style={[styles.sheetBtn, { borderColor: theme.colors.lineSoft, borderRadius: theme.radius.md }]}>
            <Text variant="bodySmall" color={theme.colors.text2}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const ms = VOICE_EXPIRY_OPTIONS[selected]?.ms ?? null;
              onConfirm(ms !== null ? Date.now() + ms : null);
            }}
            style={[styles.sheetBtn, { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent, borderRadius: theme.radius.md }]}
          >
            <Text variant="bodySmall" color={theme.colors.textOnAccent}>{t('chat.send')}</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}
