import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { Text, Pressable } from '@/components';
import {
  getVoiceRegionPreference,
  measureVoiceRegions,
  setVoiceRegionPreference,
  type RegionLatency,
  type VoiceRegionPreference,
} from '@/lib/voiceRegions';

const REFRESH_MS = 20_000;

/**
 * Central voice region preference. Automatic uses the lowest-latency region;
 * a fixed region is sent as this device's preference instead. Latency is
 * re-measured every 20 seconds while the section is open.
 */
export function VoiceRegionSection() {
  const theme = useTheme();
  const [preference, setPreference] = useState<VoiceRegionPreference>('auto');
  const [regions, setRegions] = useState<RegionLatency[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getVoiceRegionPreference().then((value) => { if (!cancelled) setPreference(value); });
    const refresh = async () => {
      const measured = await measureVoiceRegions();
      if (!cancelled) setRegions(measured);
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Hidden until Central offers regions (feature off or unreachable).
  if (regions !== null && regions.length === 0) return null;

  const fastest = (regions ?? [])
    .filter((r) => r.ms !== null)
    .sort((a, b) => (a.ms as number) - (b.ms as number))[0];

  const choose = (next: VoiceRegionPreference) => {
    setPreference(next);
    void setVoiceRegionPreference(next);
  };

  const latencyColor = (ms: number | null) => {
    if (ms === null) return theme.colors.text3;
    if (ms < 80) return theme.colors.statusColor.online;
    if (ms < 160) return theme.colors.warning;
    return theme.colors.danger;
  };

  const row = (value: VoiceRegionPreference, title: string, detail: string, detailColor: string) => {
    const selected = preference === value;
    return (
      <Pressable
        key={value}
        onPress={() => choose(value)}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        style={[
          styles.row,
          {
            borderColor: selected ? theme.colors.accent : theme.colors.text3 + '55',
            backgroundColor: selected ? theme.colors.accent + '1A' : 'transparent',
            borderRadius: theme.radius.md,
          },
        ]}
      >
        <Text variant="body" color={selected ? theme.colors.text : theme.colors.text2}>{title}</Text>
        <Text variant="caption" style={styles.ms} color={detailColor}>{detail}</Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.bgElev1,
          borderRadius: theme.radius.lg,
          marginHorizontal: theme.spacing.lg,
        },
      ]}
    >
      <Text variant="body" color={theme.colors.text}>Voice region</Text>
      <Text variant="caption" color={theme.colors.text2} style={styles.desc}>
        Used when you start a call or are first into a Central voice channel. Everyone else joins the
        same region. Latency refreshes every 20 seconds.
      </Text>
      {row('auto', 'Automatic', fastest ? `Lowest: ${fastest.label}` : 'Measuring…', theme.colors.text2)}
      {(regions ?? []).map((region) => row(
        region.id,
        region.label,
        region.ms === null ? 'Unreachable' : `${region.ms} ms`,
        latencyColor(region.ms),
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 8, marginTop: 12 },
  desc: { marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ms: { fontVariant: ['tabular-nums'] },
});
