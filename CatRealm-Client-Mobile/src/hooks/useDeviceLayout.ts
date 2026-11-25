import { Dimensions, Platform, useWindowDimensions, type KeyboardTypeOptions } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

const TABLET_MIN_WIDTH = 900;

const iosPad = Platform.OS === 'ios' && (Platform as any).isPad === true;

/**
 * Keyboard for 2FA and other one-time codes. iPadOS has no numeric pad, so
 * `number-pad` opens its full symbols keyboard; use the standard one there.
 */
export const oneTimeCodeKeyboardType: KeyboardTypeOptions = iosPad ? 'default' : 'number-pad';

/** Shortest screen side from which the app rotates freely: an unfolded foldable (the iPhone Duo's inner screen is 669pt) but not a phone (a Pro Max is about 440pt). */
const FREE_ROTATION_MIN_SIDE = 600;

/**
 * Device-stable check for orientation policy: tablets and foldables rotate freely,
 * phones stay in portrait. Uses the physical screen
 * (not the window), so the soft keyboard (softwareKeyboardLayoutMode: "resize")
 * and split-screen/multi-window can't reclassify a tablet as a phone and
 * trigger a portrait lock mid-session. Folding or unfolding changes the screen, and
 * the orientation owner re-applies the policy then. The window-based `isTablet`
 * below stays responsive for pane layout, which SHOULD react to window size.
 */
export function isTabletDevice(): boolean {
  const screen = Dimensions.get('screen');
  return iosPad || isFoldableIPhone || Math.min(screen.width, screen.height) >= FREE_ROTATION_MIN_SIDE;
}

/**
 * Whether this iPhone folds, like the iPhone Duo. A foldable must never be locked to portrait:
 * unfolding a portrait-locked app leaves it letterboxed at cover-screen size in the middle of
 * the inner screen, and its window never changes size, so nothing here could notice the unfold
 * and lift the lock. Decided at launch, on whichever screen the app opens:
 * - the inner screen: no other iPhone has a screen this large;
 * - the cover screen: a portrait screen with its status bar beside it (a side safe-area inset);
 *   other iPhones have no side insets in portrait.
 */
const isFoldableIPhone = (() => {
  if (Platform.OS !== 'ios' || iosPad) return false;
  const screen = Dimensions.get('screen');
  if (Math.min(screen.width, screen.height) >= FREE_ROTATION_MIN_SIDE) return true;
  if (!initialWindowMetrics) return false;
  const { frame, insets } = initialWindowMetrics;
  return frame.height > frame.width && (insets.left > 0 || insets.right > 0);
})();

export function useDeviceLayout() {
  const { width, height } = useWindowDimensions();
  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);
  const isTablet = iosPad || shortestSide >= 768 || width >= TABLET_MIN_WIDTH;
  const isLandscape = width > height;
  const isDesktopLike = isTablet && (width >= TABLET_MIN_WIDTH || longestSide >= 1200);

  return {
    width,
    height,
    isTablet,
    isLandscape,
    isDesktopLike,
  };
}

