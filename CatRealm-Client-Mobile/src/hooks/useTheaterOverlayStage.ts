import { useCallback, useEffect, useRef } from 'react';
import type { View } from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useTheaterStore } from '@/stores/theaterStore';

/** Upper bound on a stack slide; also covers navigations that skip the animation. */
const TRANSITION_FALLBACK_MS = 700;

type TransitionEvents = {
  addListener: (event: 'transitionEnd', listener: (event: { data?: { closing?: boolean } }) => void) => () => void;
};

/** Only the focused, joined theater screen may position the shared player. */
export function useTheaterOverlayStage(serverId: string, channelId: string, joined: boolean, width: number, height: number) {
  const stageRef = useRef<View>(null);
  const navigation = useNavigation() as unknown as TransitionEvents;
  const focusGeneration = useRef(0);
  const measurementGeneration = useRef(0);
  const active = useRef(false);
  const pendingFrame = useRef<number | null>(null);
  const ownsTheater = useCallback(() => {
    const state = useTheaterStore.getState();
    return state.serverId === serverId && state.channelId === channelId;
  }, [channelId, serverId]);

  const measure = useCallback(() => {
    if (!active.current || !ownsTheater()) return;
    const generation = focusGeneration.current;
    const measurement = ++measurementGeneration.current;
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null;
      if (!active.current || generation !== focusGeneration.current || measurement !== measurementGeneration.current || !ownsTheater()) return;
      stageRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
        if (!active.current || generation !== focusGeneration.current || measurement !== measurementGeneration.current || !ownsTheater()) return;
        if (![x, y, measuredWidth, measuredHeight].every(Number.isFinite) || measuredWidth <= 0 || measuredHeight <= 0) return;
        useTheaterStore.getState().setExpandedFrame({ x, y, width: measuredWidth, height: measuredHeight });
      });
    });
  }, [ownsTheater]);

  useFocusEffect(useCallback(() => {
    if (!joined || !ownsTheater()) return;
    const generation = ++focusGeneration.current;
    // Focus fires as the screen starts sliding in. Expanding then pins the
    // shared player to its final frame over the previous screen, so wait
    // until the slide has finished.
    const expand = () => {
      if (active.current || generation !== focusGeneration.current || !ownsTheater()) return;
      active.current = true;
      useTheaterStore.getState().setOverlayMode('expanded');
      measure(); // A kept-mounted screen may not emit onLayout when revisited.
    };
    const unsubscribe = navigation.addListener('transitionEnd', (event) => {
      if (!event?.data?.closing) expand();
    });
    const fallback = setTimeout(expand, TRANSITION_FALLBACK_MS);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
      active.current = false;
      focusGeneration.current += 1;
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = null;
      if (ownsTheater()) useTheaterStore.getState().setOverlayMode('floating');
    };
  }, [joined, measure, navigation, ownsTheater]));

  useEffect(measure, [height, measure, width]);
  return { stageRef, measure };
}
