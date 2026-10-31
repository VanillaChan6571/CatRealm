import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

/** Keep an exiting drawer mounted, without letting an obsolete close hide a reopened one. */
export function useDrawerTransition(open: boolean, width: number, onClosed?: () => void, closeRequested = false) {
  const slideAnim = useRef(new Animated.Value(-width)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const closedCallback = useRef(onClosed);
  closedCallback.current = onClosed;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    let cancelled = false;
    if (open) setMounted(true);
    const animation = Animated.parallel([
      Animated.timing(slideAnim, { toValue: open ? 0 : -width, duration: 260, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: open ? 1 : 0, duration: 260, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => {
      if (!cancelled && finished && !open) {
        setMounted(false);
        closedCallback.current?.();
      }
    });
    return () => {
      cancelled = true;
      animation.stop();
    };
  }, [open, width, slideAnim, fadeAnim, closeRequested]);

  return { slideAnim, fadeAnim, mounted };
}
