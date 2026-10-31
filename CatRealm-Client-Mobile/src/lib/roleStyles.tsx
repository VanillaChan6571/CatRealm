/**
 * Mobile parity port of CatRealm-Client/src/lib/roleStyles.ts.
 *
 * Desktop renders rgb_flow as a CSS linear-gradient text fill animated by
 * shifting `background-position` 0% → 100% over 3s linear infinite, with
 * stops `[...colors, ...colors, colors[0]]` and `background-size: 200% 100%`.
 *
 * Mobile mirrors that with a single, simple engine:
 *   MaskedView(text)  +  Animated.View translated translateX: 0 → -W
 *   inner: LinearGradient (horizontal) using the same stops, sized 2×W.
 *
 * One global Reanimated clock drives every rgb_flow text on screen, so cost
 * stays O(1) regardless of how many usernames are visible.
 */

import { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  createAnimatedComponent,
  makeMutable,
  runOnUI,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/theme';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseStyleColors(styleColors: string | null | undefined): string[] | null {
  if (!styleColors) return null;
  try {
    const parsed = JSON.parse(styleColors);
    if (Array.isArray(parsed) && parsed.length >= 2) return parsed as string[];
  } catch {
    // ignore malformed payloads
  }
  return null;
}

/**
 * Static role-name style. Mirrors desktop `getRoleNameStyle` for the non-animated
 * cases (solid / glow / gradient first-color fallback). For rgb_flow we don't
 * return a style here — the `RoleNameText` component renders the animation.
 */
export function getRoleNameStyle(
  color: string | null | undefined,
  styleType: string | null | undefined,
  styleColors: string | null | undefined,
): TextStyle {
  const type = styleType || 'solid';

  if (type === 'gradient' || type === 'rgb_flow') {
    const colors = parseStyleColors(styleColors);
    const first = colors?.[0] ?? color;
    return first ? { color: first } : {};
  }

  if (type === 'glow' && color) {
    return {
      color,
      textShadowColor: color,
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 8,
    };
  }

  return color ? { color } : {};
}

// ─── Global RGB clock ────────────────────────────────────────────────────────
// One shared progress value (0 → 1, looping every 3s) drives every rgb_flow
// text on screen. Started lazily on first use, never stopped.

const RGB_CYCLE_MS = 3000;
const rgbProgress = makeMutable(0);
let rgbClockStarted = false;

function startRgbClock() {
  runOnUI(() => {
    'worklet';
    rgbProgress.value = 0;
    rgbProgress.value = withRepeat(
      withTiming(1, { duration: RGB_CYCLE_MS, easing: Easing.linear }),
      -1,
      false,
    );
  })();
}

function ensureRgbClock() {
  if (rgbClockStarted) return;
  rgbClockStarted = true;
  startRgbClock();
}

/**
 * No-op kept for API compatibility. Earlier versions paused the clock during
 * scroll, but cancel/resume races (unmatched begin/end events from fling +
 * load-older list remounts) caused the animation to freeze or hiccup forever.
 * The single global UI-thread clock is cheap enough to leave running.
 */
export function setRgbFlowScrolling(_active: boolean) {
  // intentionally empty
}

// ─── Animated rgb_flow component ─────────────────────────────────────────────

const AnimatedLinearGradient = createAnimatedComponent(LinearGradient);

const styles = StyleSheet.create({
  base: {
    fontFamily: 'System',
    fontSize: 15,
    fontWeight: '600',
  },
  wrapper: {
    alignSelf: 'flex-start',
  },
});

interface RgbFlowTextProps {
  colors: string[];
  baseStyle: StyleProp<TextStyle>;
  numberOfLines?: number;
  wrapperStyle?: StyleProp<ViewStyle>;
  children: string;
}

function RgbFlowText({ colors, baseStyle, numberOfLines, wrapperStyle, children }: RgbFlowTextProps) {
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  // Mirror desktop: stops = [...colors, ...colors, colors[0]] across 2× width,
  // animated by sliding the gradient layer translateX 0 → -W (one period).
  const gradientColors = useMemo<readonly [string, string, ...string[]]>(() => {
    const stops = [...colors, ...colors, colors[0] ?? colors[colors.length - 1] ?? '#fff'];
    return stops.length >= 2
      ? (stops as unknown as readonly [string, string, ...string[]])
      : (['#fff', '#fff'] as const);
  }, [colors]);

  const onLayout = (event: LayoutChangeEvent) => {
    const w = Math.max(1, Math.ceil(event.nativeEvent.layout.width));
    const h = Math.max(1, Math.ceil(event.nativeEvent.layout.height));
    if (w !== width) setWidth(w);
    if (h !== height) setHeight(h);
  };

  const animatedStyle = useAnimatedStyle(() => {
    const w = Math.max(1, width);
    return { transform: [{ translateX: -w * rgbProgress.value }] };
  }, [width]);

  // Hidden measuring text → drives MaskedView size before it paints.
  if (width === 0 || height === 0) {
    return (
      <View style={[styles.wrapper, wrapperStyle]} pointerEvents="none">
        <Text
          numberOfLines={numberOfLines}
          onLayout={onLayout}
          style={[baseStyle, { opacity: 0 }]}
        >
          {children}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrapper, wrapperStyle, { width, height }]} pointerEvents="none">
      <MaskedView
        style={{ width, height }}
        maskElement={
          <View style={{ width, height, backgroundColor: 'transparent' }}>
            <Text numberOfLines={numberOfLines} style={baseStyle}>
              {children}
            </Text>
          </View>
        }
      >
        <Animated.View style={[{ width: width * 2, height }, animatedStyle]}>
          <AnimatedLinearGradient
            colors={gradientColors as unknown as readonly [string, string, ...string[]]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ width: width * 2, height }}
          />
        </Animated.View>
      </MaskedView>
      {/* Keep an invisible Text laid out for re-measure on text/font changes. */}
      <Text
        numberOfLines={numberOfLines}
        onLayout={onLayout}
        style={[baseStyle, { position: 'absolute', opacity: 0 }]}
      >
        {children}
      </Text>
    </View>
  );
}

// ─── Public RoleNameText ─────────────────────────────────────────────────────

interface RoleNameTextProps {
  color: string | null | undefined;
  styleType: string | null | undefined;
  styleColors: string | null | undefined;
  children: string;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  /** Set false to render rgb_flow as a static first-color text (e.g. during scroll). */
  animateRgbFlow?: boolean;
}

export function RoleNameText({
  color,
  styleType,
  styleColors,
  children,
  numberOfLines,
  style,
  animateRgbFlow = true,
}: RoleNameTextProps) {
  const theme = useTheme();
  const type = styleType || 'solid';
  const isRgbFlow = type === 'rgb_flow' && animateRgbFlow;

  const colors = useMemo(() => parseStyleColors(styleColors), [styleColors]);

  // baseStyle ALWAYS carries a default text color so usernames are never blank
  // when no role color is set.
  const baseStyle = useMemo<StyleProp<TextStyle>>(
    () => [styles.base, { color: theme.colors.text }, style],
    [style, theme.colors.text],
  );

  if (!isRgbFlow || !colors || colors.length < 2) {
    const staticRoleStyle = getRoleNameStyle(color, type, styleColors);
    return (
      <Text numberOfLines={numberOfLines} style={[baseStyle, staticRoleStyle]}>
        {children}
      </Text>
    );
  }

  ensureRgbClock();

  return (
    <RgbFlowText
      colors={colors}
      baseStyle={baseStyle}
      numberOfLines={numberOfLines}
      wrapperStyle={style as StyleProp<ViewStyle>}
    >
      {children}
    </RgbFlowText>
  );
}
