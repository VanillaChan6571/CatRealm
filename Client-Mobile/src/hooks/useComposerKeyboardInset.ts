import { useEffect } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { DOCK_HEIGHT, dockBottomInset } from '@/lib/dockLayout';

type Options = {
  /** Composer padding while the keyboard is hidden (default: clear the BottomDock). */
  restInset?: number;
  /** Gap kept between the composer and the keyboard. */
  keyboardGap?: number;
  /** iOS screens that move themselves (KeyboardAvoidingView / translate) only need the gap. */
  enabled?: boolean;
};

/**
 * Bottom padding for a chat composer. Android runs edge-to-edge, so
 * adjustResize no longer shrinks the window: the composer has to lift itself
 * over the keyboard. RN reports the IME height minus the nav bar, so the
 * nav-bar inset is added back.
 */
export function useComposerKeyboardInset({ restInset, keyboardGap = 4, enabled = true }: Options = {}): SharedValue<number> {
  const insets = useSafeAreaInsets();
  const rest = restInset ?? DOCK_HEIGHT + dockBottomInset(insets.bottom);
  const composerBottom = useSharedValue(rest);

  useEffect(() => {
    composerBottom.value = rest;
    if (!enabled) return;
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const lift = ios ? keyboardGap : e.endCoordinates.height + insets.bottom + keyboardGap;
      composerBottom.value = withTiming(lift, { duration: (ios ? e.duration : 0) || 250 });
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      composerBottom.value = withTiming(rest, { duration: (ios ? e.duration : 0) || 250 });
    });
    return () => { show.remove(); hide.remove(); };
  }, [composerBottom, enabled, insets.bottom, keyboardGap, rest]);

  return composerBottom;
}
