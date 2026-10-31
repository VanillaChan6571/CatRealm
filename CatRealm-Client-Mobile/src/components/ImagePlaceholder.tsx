import { useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/theme';

// Logo colours: lavender, pink and blue, from the CatRealm cat.
const LAVENDER = 'rgba(184,156,245,0.45)';
const PINK = 'rgba(244,166,192,0.32)';
const BLUE = 'rgba(111,168,255,0.32)';
const MARK_TINT = '#EDE4FF';
const MARK_MAX = 64;

// Static on purpose. The old JS-driven loop committed a Fabric update every frame,
// and on iOS each commit makes every ScrollView walk its whole subtree; with many
// images loading that hung the main thread into the 0x8BADF00D watchdog. The
// image's own fade-in is the transition.

/**
 * Loading placeholder in CatRealm colours: a still aurora wash, with the cat
 * mark on larger slots (banners, attachments, server icons).
 * Fills its parent; render it underneath the image that is loading.
 */
export function ImagePlaceholder({ radius = 0, mark = false, style }: {
  radius?: number;
  /** Show the cat silhouette. Leave off for avatars, where it gets mushy. */
  mark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  // Exact square for the mark. Percent width + maxWidth + aspectRatio let the
  // native layout produce a tall box, and the logo was stretched into it.
  const [markSize, setMarkSize] = useState(0);
  const onLayout = mark ? (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const next = Math.round(Math.min(MARK_MAX, width * 0.45, height * 0.6));
    setMarkSize((current) => (current === next ? current : next));
  } : undefined;

  return (
    <View testID="image-placeholder" pointerEvents="none" onLayout={onLayout}
      style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: radius, backgroundColor: theme.colors.bgElev2 }, style]}>
      <View style={[StyleSheet.absoluteFill, { opacity: 0.8 }]}>
        <LinearGradient colors={[LAVENDER, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 0.9 }} style={StyleSheet.absoluteFill} />
      </View>
      <View style={[StyleSheet.absoluteFill, { opacity: 0.6 }]}>
        <LinearGradient colors={['transparent', PINK]} start={{ x: 0.2, y: 0.1 }} end={{ x: 1, y: 0.7 }} style={StyleSheet.absoluteFill} />
      </View>
      <View style={[StyleSheet.absoluteFill, { opacity: 0.6 }]}>
        <LinearGradient colors={['transparent', BLUE]} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      </View>
      {mark && markSize > 0 && (
        <View style={styles.center}>
          <Image testID="image-placeholder-mark" source={require('../../assets/launch-cat.png')}
            resizeMode="contain"
            style={{ width: markSize, height: markSize, tintColor: MARK_TINT, opacity: 0.6 }} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
