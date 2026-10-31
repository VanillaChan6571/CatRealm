import { Image as ExpoImage } from 'expo-image';
import type { StyleProp, ImageStyle } from 'react-native';
import { useCachedUri } from '@/lib/imageCache';

interface CachedImageProps {
  uri: string | null | undefined;
  scope: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  accessibilityIgnoresInvertColors?: boolean;
}

export function CachedImage({ uri, scope, style, contentFit = 'cover', accessibilityIgnoresInvertColors }: CachedImageProps) {
  const cachedUri = useCachedUri(uri ?? null, scope);
  if (!cachedUri) return null;
  return (
    <ExpoImage
      source={{ uri: cachedUri }}
      style={style}
      contentFit={contentFit}
      cachePolicy="disk"
      recyclingKey={cachedUri}
      accessibilityIgnoresInvertColors={accessibilityIgnoresInvertColors}
    />
  );
}
