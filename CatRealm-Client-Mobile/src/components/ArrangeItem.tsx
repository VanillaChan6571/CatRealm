import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const WOBBLE_DEG = 0.9;
const WOBBLE_MS = 130;
/** Hold briefly before dragging so quick swipes still scroll the list. */
const DRAG_HOLD_MS = 150;

/** The drag gesture of the enclosing item (a folder), which a nested item's drag must win over. */
const ParentDragContext = createContext<GestureType | null>(null);

export type ArrangeIndicator = 'before' | 'after' | null;

/**
 * One draggable entry of the server list in arrange mode: a top-level realm or
 * folder, or a realm inside an open folder. It wobbles like an iOS home screen
 * icon, and a short hold then drag moves it. The parent owns the order and the
 * drop logic; this reports the finger's window position, slides aside
 * (`shift`) for a reorder in progress, and draws drop hints.
 */
export function ArrangeItem({
  id,
  arranging,
  dragging,
  raised = false,
  shift = 0,
  indicator = null,
  indicatorColor,
  highlight = false,
  highlightColor,
  onRegister,
  onDragStart,
  onDragMove,
  onDragEnd,
  children,
}: {
  id: string;
  arranging: boolean;
  /** This item is the one being dragged. */
  dragging: boolean;
  /** Draw above later siblings, e.g. a folder whose realm is being dragged out of it. */
  raised?: boolean;
  /** How far to slide aside for the item being dragged (0 when none is). */
  shift?: number;
  /** Show where the dragged item will land relative to this one. */
  indicator?: ArrangeIndicator;
  indicatorColor?: string;
  /** This folder is the drop target. */
  highlight?: boolean;
  highlightColor?: string;
  onRegister: (id: string, view: View | null) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, absoluteY: number) => void;
  onDragEnd: (id: string) => void;
  children: ReactNode;
}) {
  const parentDrag = useContext(ParentDragContext);
  const viewRef = useRef<View>(null);
  const tilt = useSharedValue(0);
  const dragY = useSharedValue(0);
  const offset = useSharedValue(0);
  const active = useSharedValue(0);

  // Gesture callbacks are created once per drag setup; route them through refs.
  const handlers = useRef({ onDragStart, onDragMove, onDragEnd });
  handlers.current = { onDragStart, onDragMove, onDragEnd };
  const start = useCallback((itemId: string) => handlers.current.onDragStart(itemId), []);
  const move = useCallback((itemId: string, y: number) => handlers.current.onDragMove(itemId, y), []);
  // Bumped as each drag ends, in the same update as the parent's drop, so the reset
  // below runs even when the drag was too quick for `dragging` to ever turn true.
  const [dragsEnded, setDragsEnded] = useState(0);
  const end = useCallback((itemId: string) => {
    handlers.current.onDragEnd(itemId);
    setDragsEnded((count) => count + 1);
  }, []);

  useEffect(() => {
    onRegister(id, viewRef.current);
    return () => onRegister(id, null);
  }, [id, onRegister]);

  useEffect(() => {
    if (arranging) {
      // A random start so the list doesn't wobble in lockstep.
      tilt.value = withDelay(
        Math.random() * WOBBLE_MS * 2,
        withRepeat(
          withSequence(
            withTiming(-WOBBLE_DEG, { duration: WOBBLE_MS }),
            withTiming(WOBBLE_DEG, { duration: WOBBLE_MS }),
          ),
          -1,
          true,
        ),
      );
    } else {
      cancelAnimation(tilt);
      tilt.value = withTiming(0, { duration: WOBBLE_MS });
    }
  }, [arranging, tilt]);

  useEffect(() => {
    if (!dragging) offset.value = withTiming(shift, { duration: 160 });
  }, [dragging, offset, shift]);

  // Once a drop is committed the list re-renders in its new order: snap the
  // leftover drag and slide offsets to zero before that frame is shown. Leaving
  // arrange mode does the same, so nothing can stay stacked on another realm.
  useLayoutEffect(() => {
    if (dragging || shift !== 0) return;
    cancelAnimation(offset);
    offset.value = 0;
    dragY.value = 0;
    active.value = 0;
  }, [dragging, shift, dragsEnded, arranging, offset, dragY, active]);

  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
      .enabled(arranging)
      .activateAfterLongPress(DRAG_HOLD_MS)
      .onStart(() => {
        active.value = 1;
        runOnJS(start)(id);
      })
      .onUpdate((event) => {
        dragY.value = event.translationY;
        runOnJS(move)(id, event.absoluteY);
      })
      .onFinalize(() => {
        if (!active.value) return;
        runOnJS(end)(id);
      });
    // A realm inside a folder takes the drag rather than its folder.
    return parentDrag ? gesture.blocksExternalGesture(parentDrag) : gesture;
  }, [arranging, id, parentDrag, active, dragY, start, move, end]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: active.value ? dragY.value : offset.value },
      { rotateZ: `${tilt.value}deg` },
      { scale: active.value ? 1.03 : 1 },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        ref={viewRef}
        collapsable={false}
        style={[style, { zIndex: dragging || raised ? 10 : 0 }]}
      >
        <ParentDragContext.Provider value={pan}>{children}</ParentDragContext.Provider>
        {highlight ? (
          <View pointerEvents="none" style={[styles.highlight, { borderColor: highlightColor }]} />
        ) : null}
        {indicator ? (
          <View
            pointerEvents="none"
            style={[styles.indicator, indicator === 'before' ? styles.indicatorBefore : styles.indicatorAfter, { backgroundColor: indicatorColor }]}
          />
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  highlight: {
    ...StyleSheet.absoluteFill,
    borderRadius: 20,
    borderWidth: 2,
  },
  indicator: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 3,
    borderRadius: 2,
  },
  indicatorBefore: { top: -5 },
  indicatorAfter: { bottom: -5 },
});
