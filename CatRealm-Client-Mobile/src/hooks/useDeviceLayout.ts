import { Dimensions, Platform, useWindowDimensions } from 'react-native';

const TABLET_MIN_WIDTH = 900;

const iosPad = Platform.OS === 'ios' && (Platform as any).isPad === true;

/**
 * Device-stable tablet check for orientation policy. Uses the physical screen
 * (not the window), so the soft keyboard (softwareKeyboardLayoutMode: "resize")
 * and split-screen/multi-window can't reclassify a tablet as a phone and
 * trigger a portrait lock mid-session. The window-based `isTablet` below stays
 * responsive for pane layout, which SHOULD react to window size.
 */
export function isTabletDevice(): boolean {
  const screen = Dimensions.get('screen');
  return iosPad || Math.min(screen.width, screen.height) >= 768;
}

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

