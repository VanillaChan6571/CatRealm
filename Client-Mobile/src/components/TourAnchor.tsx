import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import { registerTourAnchor } from '@/lib/tourAnchors';

const TourScrollContext = createContext<((windowY: number) => void) | undefined>(undefined);

/** Marks a view the app tour can point at. */
export function TourAnchor({ name, style, children }: { name: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const ref = useRef<View>(null);
  const scrollIntoView = useContext(TourScrollContext);
  useEffect(() => {
    if (!ref.current) return;
    return registerTourAnchor(name, { view: ref.current, scrollIntoView });
  }, [name, scrollIntoView]);
  return <View ref={ref} collapsable={false} style={style}>{children}</View>;
}

/** Anchors inside it can be scrolled into view by the tour (see useTourScroller). */
export const TourScrollProvider = TourScrollContext.Provider;

/**
 * Lets anchors inside a ScrollView be scrolled into view by the tour. Pass
 * `onScroll` to the ScrollView and `scrollIntoView` to a TourScrollProvider.
 */
export function useTourScroller(scrollRef: RefObject<ScrollView | null>) {
  const offset = useRef(0);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);
  // Put the anchor roughly a third of the way down, clear of the tour card.
  const scrollIntoView = useCallback((windowY: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, offset.current + windowY - 180), animated: true });
  }, [scrollRef]);
  return { onScroll, scrollIntoView };
}
