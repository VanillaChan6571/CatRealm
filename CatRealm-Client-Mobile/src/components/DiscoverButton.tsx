/**
 * DiscoverButton — ports the desktop `.discover-nav-button` animation to React Native.
 *
 * Two layered effects matching the CSS original:
 *   1. discoverBreath — gentle purple glow pulse + 1px vertical lift (2.8s ease-in-out loop)
 *   2. discoverSparkle — white shimmer gradient sweeping left→right over the button (3.3s linear loop)
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Compass } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Pressable } from '@/components/Pressable';
import { TourAnchor } from '@/components/TourAnchor';

interface DiscoverButtonProps {
  onPress: () => void;
  label?: string;
}

const BREATH_DURATION = 2800;
const SPARKLE_DURATION = 3300;

export function DiscoverButton({ onPress, label = 'Discover Servers' }: DiscoverButtonProps) {
  const theme = useTheme();

  // ── Breath: translateY 0 → -1 → 0 and glow opacity 0.15 → 0.35 → 0.15
  const translateY = useSharedValue(0);
  const glowOpacity = useSharedValue(0.15);

  // ── Sparkle: translateX sweeps from -100% to +220% of button width
  const sparkleX = useSharedValue(-1);

  useEffect(() => {
    const easingBreath = Easing.inOut(Easing.ease);

    translateY.value = withRepeat(
      withSequence(
        withTiming(-1, { duration: BREATH_DURATION / 2, easing: easingBreath }),
        withTiming(0, { duration: BREATH_DURATION / 2, easing: easingBreath }),
      ),
      -1,
      false,
    );

    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: BREATH_DURATION / 2, easing: easingBreath }),
        withTiming(0.15, { duration: BREATH_DURATION / 2, easing: easingBreath }),
      ),
      -1,
      false,
    );

    sparkleX.value = withRepeat(
      withTiming(3.2, { duration: SPARKLE_DURATION, easing: Easing.linear }),
      -1,
      false,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buttonAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const glowAnimStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  // sparkleX goes from -1 (off-screen left) to 3.2 (off-screen right),
  // as a multiplier of the button width — resolved in the inner style below.
  const sparkleAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sparkleX.value * 120 }],
  }));

  return (
    <TourAnchor name="discover">
    <Animated.View style={[styles.wrapper, buttonAnimStyle]}>
      {/* Purple glow border — animated opacity */}
      <Animated.View style={[styles.glowBorder, glowAnimStyle]} />

      <Pressable
        haptic
        onPress={onPress}
        style={[styles.btn, { borderRadius: theme.radius.md }]}
      >
        <Compass size={22} color={theme.colors.text2} style={styles.icon} />
        <Text variant="body" color={theme.colors.text}>{label}</Text>

        {/* Sparkle shimmer — clipped to button bounds */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View style={[styles.sparkleTrack, sparkleAnimStyle]} pointerEvents="none">
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.18)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.sparkleGradient}
            />
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
    </TourAnchor>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  glowBorder: {
    ...StyleSheet.absoluteFill,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(124,92,255,1)',
    shadowColor: 'rgba(124,92,255,1)',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
    shadowOpacity: 1,
    pointerEvents: 'none',
  } as object,
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 14,
    paddingHorizontal: 10,
    paddingVertical: 14,
    overflow: 'hidden',
  },
  icon: {
    width: 24,
  },
  sparkleTrack: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '42%',
    left: 0,
  },
  sparkleGradient: {
    flex: 1,
  },
});
