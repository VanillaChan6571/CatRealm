import { StyleSheet, View } from 'react-native';

// Static on purpose. The old breathing loop was JS-driven, so it committed a
// Fabric update every frame; on iOS each commit makes every ScrollView walk its
// whole subtree, which hung the main thread into the 0x8BADF00D watchdog.

/**
 * A full-strength outline over whatever it sits in, on a faint resting outline.
 * The host keeps its size and fill. Place it inside the host view; it fills it.
 */
export function PulsingBorder({ color, radius, width = 1.5 }: { color: string; radius: number; width?: number }) {
  const outline = { borderRadius: radius, borderWidth: width, borderColor: color };
  return (
    <View testID="pulsing-border" pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, outline, { opacity: 0.35 }]} />
      <View testID="pulsing-border-glow" style={[StyleSheet.absoluteFill, outline]} />
    </View>
  );
}
