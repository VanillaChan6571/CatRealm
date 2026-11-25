import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Horizontal padding for a screen's top bar that keeps its buttons clear of side safe areas.
 * The iPhone Duo's cover screen keeps its camera, clock and status icons in a column at the
 * top right, which iOS reports as a right inset. It only covers the top of the screen, so only
 * top bars step in for it; everything below them (lists, the composer, backgrounds) keeps the
 * full width. Elsewhere the side insets are 0 in portrait and this is just `horizontal`.
 */
export function useTopBarPadding(horizontal: number) {
  const insets = useSafeAreaInsets();
  return { paddingLeft: horizontal + insets.left, paddingRight: horizontal + insets.right };
}
