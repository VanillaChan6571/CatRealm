import { useCallback, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage, type ImageLoadEventData } from 'expo-image';
import { ImagePlaceholder } from './ImagePlaceholder';

/** Fade length for images arriving over their placeholder. */
export const IMAGE_FADE_MS = 250;

// Images already shown this session. Switching tabs remounts every avatar and
// attachment; they must reappear at once instead of replaying placeholder + fade.
const shownImages = new Set<string>();
const SHOWN_IMAGES_MAX = 2000;

/**
 * Load state for an image drawn over a placeholder. `loaded` is true straight
 * away for an image already shown this session, and `transition` drops the
 * fade for it, so a remount does not flash.
 */
export function useImageReveal(uri: string | null) {
  const seen = !!uri && shownImages.has(uri);
  const [loadedUri, setLoadedUri] = useState<string | null>(seen ? uri : null);
  const markLoaded = useCallback(() => {
    if (!uri) return;
    if (!shownImages.has(uri)) {
      if (shownImages.size >= SHOWN_IMAGES_MAX) shownImages.delete(shownImages.values().next().value as string);
      shownImages.add(uri);
    }
    setLoadedUri(uri);
  }, [uri]);
  return { loaded: !!uri && (seen || loadedUri === uri), transition: seen ? 0 : IMAGE_FADE_MS, markLoaded };
}

/**
 * An image that fades in over the CatRealm loading placeholder instead of
 * popping in. Fills `style`'s box; the placeholder is dropped once loaded.
 */
export function FadeInImage({ uri, style, radius = 0, mark = true, contentFit = 'cover', onLoad, accessibilityLabel }: {
  uri: string;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** Cat mark on the placeholder; on by default since these are large slots. */
  mark?: boolean;
  contentFit?: 'cover' | 'contain';
  onLoad?: (event: ImageLoadEventData) => void;
  accessibilityLabel?: string;
}) {
  const { loaded, transition, markLoaded } = useImageReveal(uri);
  // A failed banner falls back to the plain box instead of loading forever.
  const [failedUri, setFailedUri] = useState<string | null>(null);

  return (
    <View style={[styles.box, { borderRadius: radius }, style]}>
      {!loaded && failedUri !== uri && <ImagePlaceholder radius={radius} mark={mark} />}
      <ExpoImage source={{ uri }} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} contentFit={contentFit}
        cachePolicy="disk" recyclingKey={uri} transition={transition} accessibilityIgnoresInvertColors
        accessibilityLabel={accessibilityLabel}
        onLoad={(event) => { markLoaded(); onLoad?.(event); }} onError={() => setFailedUri(uri)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
