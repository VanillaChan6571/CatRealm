// Central motion system for the CatRealm client.
//
// One vocabulary of transitions + variants, scaled by the user's motion
// intensity setting (Snappy / Middle / Lively, default Middle — see
// settingsStore `motionIntensity`). Components read the active profile via
// `useMotionProfile()` instead of hardcoding durations, so the whole app's
// "feel" moves together with one setting.
//
// OS `prefers-reduced-motion` is honored separately and automatically by the
// <MotionConfig reducedMotion="user"> provider mounted in App.tsx, plus a CSS
// belt-and-suspenders guard in index.css — neither depends on this module.
import type { Transition, Variants } from 'motion/react';
import { useSettingsStore, type MotionIntensity } from '../stores/settingsStore';

type Bezier = [number, number, number, number];

const spring = (stiffness: number, damping: number, mass = 0.9): Transition => ({
  type: 'spring',
  stiffness,
  damping,
  mass,
});

// Default ease is an ease-out quint-ish curve — quick start, gentle settle.
const tween = (duration: number, ease: Bezier = [0.22, 1, 0.36, 1]): Transition => ({
  duration,
  ease,
});

export interface MotionProfile {
  // Raw transitions — pass straight into a `transition` prop when not using a
  // prebuilt variant.
  overlay: Transition; // modal / popover panel
  sheet: Transition; // bottom & side drawers
  pop: Transition; // reactions, badges, small affordances
  listItem: Transition; // live message / row entrance
  tabSwap: Transition; // settings & section crossfade
  fade: Transition; // generic opacity (backdrops)
  exit: Transition; // shared quick exit (exits should feel snappier than entrances)
  // Scale target for press feedback (whileTap / active:scale-*).
  pressScale: number;
  // Prebuilt variants — spread into a `variants` prop with
  // initial="initial" animate="animate" exit="exit".
  backdropVariants: Variants;
  panelVariants: Variants;
  slideUpVariants: Variants;
  popVariants: Variants;
  tabVariants: Variants;
  listItemVariants: Variants;
}

interface ProfileTimings {
  overlay: Transition;
  sheet: Transition;
  pop: Transition;
  listItem: Transition;
  tabSwap: Transition;
  fade: Transition;
  exit: Transition;
  pressScale: number;
}

function buildProfile(t: ProfileTimings): MotionProfile {
  return {
    ...t,
    backdropVariants: {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: t.fade },
      exit: { opacity: 0, transition: t.exit },
    },
    panelVariants: {
      initial: { opacity: 0, scale: 0.96, y: 8 },
      animate: { opacity: 1, scale: 1, y: 0, transition: t.overlay },
      exit: { opacity: 0, scale: 0.97, y: 4, transition: t.exit },
    },
    slideUpVariants: {
      initial: { opacity: 0, y: 16 },
      animate: { opacity: 1, y: 0, transition: t.sheet },
      exit: { opacity: 0, y: 12, transition: t.exit },
    },
    popVariants: {
      initial: { opacity: 0, scale: 0.6 },
      animate: { opacity: 1, scale: 1, transition: t.pop },
      exit: { opacity: 0, scale: 0.7, transition: t.exit },
    },
    tabVariants: {
      initial: { opacity: 0, x: 10 },
      animate: { opacity: 1, x: 0, transition: t.tabSwap },
      exit: { opacity: 0, x: -10, transition: t.exit },
    },
    listItemVariants: {
      initial: { opacity: 0, y: 12 },
      animate: { opacity: 1, y: 0, transition: t.listItem },
    },
  };
}

export const MOTION_PROFILES: Record<MotionIntensity, MotionProfile> = {
  // Crisp: stiff springs, no overshoot, short tweens.
  snappy: buildProfile({
    overlay: spring(520, 40, 0.8),
    sheet: spring(480, 42, 0.8),
    pop: spring(560, 32, 0.7),
    listItem: spring(520, 40, 0.8),
    tabSwap: tween(0.14),
    fade: tween(0.12),
    exit: tween(0.1),
    pressScale: 0.985,
  }),
  // Balanced default — the Apple sweet spot. Slight life on pops.
  middle: buildProfile({
    overlay: spring(380, 30, 0.9),
    sheet: spring(340, 32, 0.9),
    pop: spring(420, 24, 0.8),
    listItem: spring(380, 30, 0.9),
    tabSwap: tween(0.22),
    fade: tween(0.18),
    exit: tween(0.15),
    pressScale: 0.97,
  }),
  // Springy: visible bounce/overshoot, more personality.
  lively: buildProfile({
    overlay: spring(300, 22, 1),
    sheet: spring(280, 22, 1),
    pop: spring(340, 16, 0.9),
    listItem: spring(300, 20, 1),
    tabSwap: tween(0.3, [0.34, 1.56, 0.64, 1]),
    fade: tween(0.24),
    exit: tween(0.18),
    pressScale: 0.95,
  }),
};

/**
 * The active motion profile, reactive to the user's intensity setting.
 * Cheap: returns a stable, module-level object (no per-render allocation).
 */
export function useMotionProfile(): MotionProfile {
  const intensity = useSettingsStore((s) => s.motionIntensity);
  return MOTION_PROFILES[intensity] ?? MOTION_PROFILES.middle;
}
