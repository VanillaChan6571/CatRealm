import { forwardRef } from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

type SafeAreaViewProps = ViewProps & { edges?: readonly Edge[] };

function basePadding(style: ViewStyle, side: 'Top' | 'Right' | 'Bottom' | 'Left'): number {
  const axis = side === 'Top' || side === 'Bottom' ? style.paddingVertical : style.paddingHorizontal;
  const value = style[`padding${side}`] ?? axis ?? style.padding;
  return typeof value === 'number' ? value : 0;
}

/**
 * Drop-in for react-native-safe-area-context's SafeAreaView. The native view
 * applies its insets one layout pass after the first frame on Android, so
 * screen titles drew under the status bar and then jumped down. The
 * SafeAreaProvider only renders children once insets are known, so the hook
 * already has them on the first frame.
 */
export const SafeAreaView = forwardRef<View, SafeAreaViewProps>(function SafeAreaView(
  { edges = ALL_EDGES, style, ...rest },
  ref,
) {
  const insets = useSafeAreaInsets();
  const flat: ViewStyle = StyleSheet.flatten(style) ?? {};
  const padding: ViewStyle = {};
  if (edges.includes('top')) padding.paddingTop = basePadding(flat, 'Top') + insets.top;
  if (edges.includes('right')) padding.paddingRight = basePadding(flat, 'Right') + insets.right;
  if (edges.includes('bottom')) padding.paddingBottom = basePadding(flat, 'Bottom') + insets.bottom;
  if (edges.includes('left')) padding.paddingLeft = basePadding(flat, 'Left') + insets.left;

  return <View ref={ref} style={[style, padding]} {...rest} />;
});
