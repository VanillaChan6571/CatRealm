/**
 * Sheet — bottom sheet or left drawer. Lightweight slide-in + scrim, not a full
 * gesture-driven sheet. For production-grade sheets with snap points and
 * pan-to-dismiss, swap in @gorhom/bottom-sheet later.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <Sheet open={open} onClose={() => setOpen(false)}>...</Sheet>
 */

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Animated,
  StyleSheet,
  Modal,
  Pressable as RNPressable,
  Keyboard,
  Platform,
  useWindowDimensions,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { OverlayPortal } from './OverlayPortal';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Max height as a fraction of viewport. Default 0.85. */
  maxHeightFraction?: number;
  /** Caps the sheet's width and centres it (tablets). */
  maxWidth?: number;
  /** iOS: sit above the keyboard, shrinking to fit. Android resizes the window itself. */
  avoidKeyboard?: boolean;
  /** Left-edge drawer for tablet editing flows; bottom remains the default. */
  presentation?: 'bottom' | 'left';
  /** Window-coordinate edge of the source pane; drawers expand right from here. */
  anchorRight?: number;
}

export function Sheet({ open, onClose, children, maxHeightFraction = 0.85, maxWidth, avoidKeyboard = false, presentation = 'bottom', anchorRight = 0 }: SheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const isDrawer = presentation === 'left';
  const drawerLeft = Math.max(0, Math.min(anchorRight, windowWidth - Math.min(280, windowWidth)));
  const drawerWidth = Math.min(maxWidth ?? 420, windowWidth - drawerLeft);
  const hiddenOffset = isDrawer ? -drawerWidth : windowHeight;
  const [mounted, setMounted] = useState(open);
  const lastChildren = useRef<ReactNode>(null);
  useLayoutEffect(() => {
    if (open) lastChildren.current = children;
  }, [open, children]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (!isDrawer || !open) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [isDrawer, open, onClose]);
  useEffect(() => {
    if (!avoidKeyboard || !open || Platform.OS !== 'ios') return;
    const change = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      setKeyboardHeight(Math.max(0, windowHeight - event.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => { change.remove(); hide.remove(); setKeyboardHeight(0); };
  }, [avoidKeyboard, open, windowHeight]);
  const translation = useRef(new Animated.Value(hiddenOffset)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    if (open) setMounted(true);
    else if (lastChildren.current !== null && avoidKeyboard) Keyboard.dismiss();
    const animation = open
      ? Animated.parallel([
        Animated.spring(translation, {
          toValue: 0,
          useNativeDriver: true,
          damping: 22,
          stiffness: 220,
        }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ])
      : Animated.parallel([
        Animated.timing(translation, { toValue: hiddenOffset, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]);
    animation.start(({ finished }) => {
      if (!cancelled && finished && !open) {
        setMounted(false);
        lastChildren.current = null;
      }
    });
    return () => { cancelled = true; animation.stop(); };
  }, [open, opacity, translation, hiddenOffset, avoidKeyboard]);

  const maxHeight = isDrawer ? windowHeight : windowHeight * maxHeightFraction;
  const height = keyboardHeight > 0
    ? Math.max(0, Math.min(maxHeight, windowHeight - keyboardHeight - (isDrawer ? 0 : insets.top + 12)))
    : maxHeight;

  const content = (
      <View pointerEvents={!open ? 'none' : isDrawer ? 'box-none' : 'auto'} style={[styles.root, isDrawer && styles.drawerRoot]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { left: isDrawer ? drawerLeft : 0, backgroundColor: theme.colors.scrim, opacity }]} />
        <RNPressable testID="sheet-backdrop" style={[StyleSheet.absoluteFill, { left: isDrawer ? drawerLeft : 0 }]} onPress={onClose} />
        {/* Clip the entering panel at its source edge so it never slides over the list. */}
        <View testID="sheet-viewport" pointerEvents="box-none" style={isDrawer
          ? { position: 'absolute', top: 0, bottom: 0, left: drawerLeft, right: 0, overflow: 'hidden' }
          : styles.root}>
        <Animated.View
          testID="sheet-panel"
          style={[
            styles.sheet,
            !isDrawer && maxWidth ? { width: '100%', maxWidth, alignSelf: 'center' } : null,
            // Edge-to-edge modals draw under the system nav bar (Android 3-button bar ~48dp).
            { paddingBottom: keyboardHeight > 0 ? 8 : Math.max(24, insets.bottom + 8) },
            {
              backgroundColor: theme.colors.bgElev1,
              borderTopLeftRadius: isDrawer ? 0 : theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              height,
              marginBottom: isDrawer ? 0 : keyboardHeight,
              transform: isDrawer ? [{ translateX: translation }] : [{ translateY: translation }],
            },
            isDrawer ? {
              width: drawerWidth,
              paddingTop: insets.top,
              paddingLeft: drawerLeft === 0 ? insets.left : 0,
              paddingBottom: keyboardHeight > 0 ? 8 : Math.max(24, insets.bottom),
              borderBottomRightRadius: theme.radius.xl,
              borderRightWidth: StyleSheet.hairlineWidth,
              borderRightColor: theme.colors.lineSoft,
            } : null,
            theme.shadow.sheet,
          ]}
        >
          {!isDrawer ? <View testID="sheet-handle" style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: theme.colors.line }]} />
          </View> : null}
          {open ? children : lastChildren.current}
        </Animated.View>
        </View>
      </View>
  );
  if (isDrawer) return mounted ? <OverlayPortal>{content}</OverlayPortal> : null;
  return (
    <Modal testID="sheet-modal" visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  drawerRoot: { justifyContent: 'flex-start', alignItems: 'flex-start' },
  sheet: { paddingBottom: 24 },
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 36, height: 4, borderRadius: 2 },
});
