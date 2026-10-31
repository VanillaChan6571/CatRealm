/**
 * Pressable — thin wrapper over RN Pressable that adds a default press
 * animation and a 44pt minimum hit target. Use this everywhere instead of
 * touching `Pressable` from 'react-native' directly so feel stays consistent.
 */

import { forwardRef, type ElementRef, type ReactNode } from 'react';
import { Pressable as RNPressable, StyleSheet, type PressableProps } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme';

export interface PressableProps_ extends Omit<PressableProps, 'children' | 'style'> {
  children: ReactNode;
  style?: PressableProps['style'];
  /** Trigger a light haptic on press. Default: false (cheap to opt-in). */
  haptic?: boolean | 'light' | 'medium' | 'heavy';
  /** Minimum hit target size — defaults to theme.hit.min (44pt). */
  minHit?: number;
}

export const Pressable = forwardRef<
  ElementRef<typeof RNPressable>,
  PressableProps_
>(function Pressable(
  { children, style, haptic, minHit, onPress, ...rest },
  ref,
) {
  const theme = useTheme();
  const hit = minHit ?? theme.hit.min;

  return (
    <RNPressable
      ref={ref}
      hitSlop={8}
      style={(state) => [
        styles.base,
        { minHeight: hit, minWidth: hit },
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
      onPress={(e) => {
        if (haptic) {
          const intensity =
            haptic === 'medium'
              ? Haptics.ImpactFeedbackStyle.Medium
              : haptic === 'heavy'
                ? Haptics.ImpactFeedbackStyle.Heavy
                : Haptics.ImpactFeedbackStyle.Light;
          void Haptics.impactAsync(intensity);
        }
        onPress?.(e);
      }}
      {...rest}
    >
      {children}
    </RNPressable>
  );
});

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
