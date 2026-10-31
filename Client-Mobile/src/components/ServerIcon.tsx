/**
 * ServerIcon — squircle tile shown in server navigation and chat headers.
 * Mirrors desktop server identity and notification semantics while adapting
 * hit area and sizing for native mobile.
 */

import { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { ImagePlaceholder } from './ImagePlaceholder';
import { useImageReveal } from './FadeInImage';
import { useTheme } from '@/theme';
import { resolveMediaUrl } from '@/utils/mediaUrl';
import { useCachedUri, realmScope } from '@/lib/imageCache';
import type { MobileServer } from '@/stores/serverStore';
import type { StyleProp, ViewStyle } from 'react-native';
import { Text } from './Text';

export interface ServerIconProps {
  server: Pick<MobileServer, 'name' | 'iconUrl'> & { url?: string | null };
  size?: number;
  active?: boolean;
  badge?: number;
  /** Unread messages without a mention: a small dot instead of a count. */
  unread?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ServerIcon({ server, size = 50, active = false, badge = 0, unread = false, style }: ServerIconProps) {
  const theme = useTheme();
  const radius = active ? Math.round(size * 0.32) : Math.round(size * 0.5);
  const iconUri = useMemo(
    () => resolveMediaUrl(server.iconUrl, server.url),
    [server.iconUrl, server.url],
  );
  const cachedUri = useCachedUri(iconUri, realmScope(server.url ?? iconUri ?? ''));
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const imageUri = cachedUri && cachedUri !== failedUri ? cachedUri : null;
  const { loaded, transition, markLoaded } = useImageReveal(imageUri);

  useEffect(() => {
    setFailedUri(null);
  }, [iconUri]);

  const initials = (server.name || '?')
    .split(' ')
    .map((s) => s.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: active ? theme.colors.accent : theme.colors.bgElev2,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: active ? theme.colors.accentRim : theme.colors.line,
        }}
      >
        {imageUri ? (
          <>
            {!loaded && <ImagePlaceholder mark />}
            <ExpoImage
              source={{ uri: imageUri }}
              style={{ width: size, height: size }}
              contentFit="cover"
              cachePolicy="memory"
              transition={transition}
              onLoad={markLoaded}
              onError={() => setFailedUri(imageUri)}
              accessibilityIgnoresInvertColors
            />
          </>
        ) : (
          <Text
            variant="subtitle"
            color={active ? theme.colors.textOnAccent : theme.colors.text}
            style={{ fontSize: size * 0.36 }}
          >
            {initials}
          </Text>
        )}
      </View>
      {badge === 0 && unread && (
        <View testID="server-icon-unread" style={[styles.unreadDot, { backgroundColor: theme.colors.text, borderColor: theme.colors.bgApp }]} />
      )}
      {badge > 0 && (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: theme.colors.danger,
              borderColor: theme.colors.bgApp,
            },
          ]}
        >
          <Text
            variant="caption"
            color={'#fff'}
            style={{ fontSize: 10, lineHeight: 14 }}
          >
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
