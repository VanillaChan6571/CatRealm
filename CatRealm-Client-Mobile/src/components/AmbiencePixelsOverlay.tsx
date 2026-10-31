import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useAmbienceFxStore } from '@/stores/ambienceFxStore';
import { useAppForeground } from '@/hooks/useAppForeground';
import { AMBIENCE_COLORS, AMBIENCE_SPAWN_RATE, MAX_AMBIENCE_PARTICLES, ambienceParticleMotion } from '@/lib/ambienceParticles';
import { trackMemoryResource } from '@/lib/memoryResources';

function ParticlePool({ spawning, width, height, onActivityChange }: {
  spawning: boolean; width: number; height: number; onActivityChange: (active: boolean) => void;
}) {
  // Reuse views/values. No per-frame setState, style allocations, or layout updates.
  const [slots] = useState(() => Array.from({ length: MAX_AMBIENCE_PARTICLES }, () => ({
    position: new Animated.ValueXY({ x: 0, y: 0 }),
    opacity: new Animated.Value(0),
    size: 2 + Math.random() * 3.5,
    color: AMBIENCE_COLORS[Math.floor(Math.random() * AMBIENCE_COLORS.length)],
    animation: null as Animated.CompositeAnimation | null,
  })));
  const live = useRef(false);
  const particleMetrics = useRef<ReturnType<typeof trackMemoryResource> | null>(null);
  useEffect(() => {
    live.current = true;
    const views = trackMemoryResource('particleViews', slots.length);
    const particles = trackMemoryResource('activeParticles', 0);
    particleMetrics.current = particles;
    return () => {
      live.current = false;
      particleMetrics.current = null;
      particles.dispose();
      views.dispose();
      for (const slot of slots) {
        const animation = slot.animation;
        slot.animation = null;
        animation?.stop();
        slot.position.stopAnimation();
        slot.opacity.stopAnimation();
      }
    };
  }, [slots]);

  useEffect(() => {
    if (!spawning) {
      if (slots.every((slot) => !slot.animation)) onActivityChange(false);
      return;
    }
    const timer = setInterval(() => {
      const slot = slots.find((candidate) => !candidate.animation);
      if (!slot || !live.current) return;
      const wasEmpty = slots.every((candidate) => !candidate.animation);
      const motion = ambienceParticleMotion(width, height);
      slot.position.setValue(motion.from);
      slot.opacity.setValue(1);
      const animation = Animated.timing(slot.position, {
        toValue: motion.to, duration: motion.duration, easing: Easing.linear,
        useNativeDriver: true, isInteraction: false,
      });
      slot.animation = animation;
      if (__DEV__) particleMetrics.current?.setCount(slots.reduce((count, candidate) => count + Number(Boolean(candidate.animation)), 0));
      if (wasEmpty) onActivityChange(true);
      animation.start(() => {
        if (!live.current || slot.animation !== animation) return;
        slot.animation = null;
        if (__DEV__) particleMetrics.current?.setCount(slots.reduce((count, candidate) => count + Number(Boolean(candidate.animation)), 0));
        slot.opacity.setValue(0);
        if (slots.every((candidate) => !candidate.animation)) onActivityChange(false);
      });
    }, 1000 / AMBIENCE_SPAWN_RATE);
    // Let visible particles drain when disabled; unmount/background stops all.
    return () => clearInterval(timer);
  }, [height, onActivityChange, slots, spawning, width]);

  return <View testID="ambience-particle-pool" pointerEvents="none" style={styles.overlay}>
    {slots.map((slot, index) => <Animated.View key={index} testID="ambience-particle" style={[
      styles.pixel,
      { width: slot.size, height: slot.size, backgroundColor: slot.color, shadowColor: slot.color,
        opacity: slot.opacity, transform: slot.position.getTranslateTransform() },
    ]} />)}
  </View>;
}

export function AmbiencePixelsOverlay() {
  const spawning = useAmbienceFxStore((s) => s.spawning);
  const foreground = useAppForeground();
  const { width, height } = useWindowDimensions();
  const [draining, setDraining] = useState(false);
  if (!foreground || (!spawning && !draining)) return null;
  return <ParticlePool key={width + ':' + height} spawning={spawning} width={width} height={height} onActivityChange={setDraining} />;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 1400 },
  pixel: { position: 'absolute', left: 0, top: 0, borderRadius: 1, shadowOpacity: 0.9, shadowRadius: 6, elevation: 8 },
});
