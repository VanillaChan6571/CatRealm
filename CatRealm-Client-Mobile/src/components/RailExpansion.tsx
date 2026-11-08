import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/** The drawer icon rail's collapsed (icons only) width. */
export const RAIL_WIDTH = 66;
/** How long the rail takes to widen or shrink; callers wait this long before a handoff. */
export const RAIL_EXPAND_MS = 240;

/** Expansion progress (0 = icons, 1 = full width) of a rail that can show labels. */
const RailProgressContext = createContext<SharedValue<number> | null>(null);

/**
 * The drawer's icon rail container. When `labels` is set it can widen from the
 * icon column to `expandedWidth`; items keep their icons at the same x, so the
 * growing width reveals their labels sideways. Rails without labels stay at
 * RAIL_WIDTH and render no labels at all.
 */
export function ExpandingRail({
  labels = false,
  expanded = false,
  expandedWidth = RAIL_WIDTH,
  style,
  children,
}: {
  labels?: boolean;
  expanded?: boolean;
  expandedWidth?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const progress = useSharedValue(labels && expanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(labels && expanded ? 1 : 0, {
      duration: RAIL_EXPAND_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [labels, expanded, progress]);

  const widthStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [RAIL_WIDTH, Math.max(RAIL_WIDTH, expandedWidth)]),
  }));

  return (
    <Animated.View style={[style, widthStyle, { overflow: 'hidden' }]}>
      <RailProgressContext.Provider value={labels ? progress : null}>{children}</RailProgressContext.Provider>
    </Animated.View>
  );
}

/** A rail item's label: fades and slides in as the rail widens; absent in icon-only rails. */
export function RailLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const progress = useContext(RailProgressContext);
  const fade = useAnimatedStyle(() => {
    const value = progress?.value ?? 0;
    return {
      opacity: interpolate(value, [0.35, 1], [0, 1], 'clamp'),
      transform: [{ translateX: interpolate(value, [0, 1], [-10, 0]) }],
    };
  });
  if (!progress) return null;
  return <Animated.View style={[{ flex: 1, minWidth: 0 }, fade, style]}>{children}</Animated.View>;
}
