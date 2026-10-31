import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from 'react-native';

/** Same colour and artwork as the native splash, so the hand-off is invisible. */
export const LAUNCH_BACKGROUND = '#171225';
/** expo-splash-screen draws the image at 100pt (its default imageWidth). */
const NATIVE_SPLASH_SIZE = 100;
const CAT_SIZE = 160;
const GLOW_SIZE = 210;
const EXIT_MS = 650;
const DOT_COLOR = '#9B77FF';

// Native-driven: the reveal runs exactly while JS is busiest (mounting the app,
// connecting sockets), and JS-driven frames were dropped until it just flashed.
// On Fabric a native-driven animation snaps back if its view re-renders, so the
// component is memoised and must only receive stable props.
const driver = { useNativeDriver: true } as const;
/** Frames closer than this mean JS is keeping up, i.e. the app has rendered. */
const IDLE_FRAME_MS = 34;
const IDLE_FRAMES_NEEDED = 3;
const MAX_IDLE_WAIT_MS = 1500;

/**
 * Native interpolation rejects `easing`, so bake the curve into keyframes:
 * each segment between consecutive points is sampled along `easing`.
 */
export function easedKeyframes(points: [number, number][], easing: (t: number) => number, steps = 8) {
  const inputRange = [points[0][0]];
  const outputRange = [points[0][1]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      inputRange.push(x0 + (x1 - x0) * t);
      outputRange.push(y0 + (y1 - y0) * easing(t));
    }
  }
  return { inputRange, outputRange };
}

/** Resolves once JS delivers a few smooth frames in a row (or after a cap). */
function whenJsIdle(onIdle: () => void) {
  const started = Date.now();
  let last = 0;
  let smooth = 0;
  let raf = 0;
  let done = false;
  const tick = (now: number) => {
    smooth = last && now - last < IDLE_FRAME_MS ? smooth + 1 : 0;
    last = now;
    if (smooth >= IDLE_FRAMES_NEEDED || Date.now() - started > MAX_IDLE_WAIT_MS) {
      done = true;
      onIdle();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { if (!done) cancelAnimationFrame(raf); };
}

type LaunchValues = { intro: Animated.Value; breathe: Animated.Value; exit: Animated.Value; dots: Animated.Value[] };

/**
 * Launch screen that continues the native splash: the cat grows from the
 * splash size and breathes with a glow and loading dots until `ready`, then
 * pops, zooms away and fades to reveal the app. Calls `onDone` when finished.
 */
export function LaunchReveal({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const values = useRef<LaunchValues>({
    intro: new Animated.Value(0),
    breathe: new Animated.Value(0),
    exit: new Animated.Value(0),
    dots: [0, 1, 2].map(() => new Animated.Value(0)),
  }).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (mounted) setReduceMotion(enabled); })
      .catch(() => { if (mounted) setReduceMotion(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion !== false) {
      if (reduceMotion) values.intro.setValue(1);
      return;
    }
    Animated.spring(values.intro, { toValue: 1, friction: 6, tension: 60, ...driver }).start();
    const ease = Easing.inOut(Easing.sin);
    const loops = [
      Animated.loop(Animated.sequence([
        Animated.timing(values.breathe, { toValue: 1, duration: 800, easing: ease, ...driver }),
        Animated.timing(values.breathe, { toValue: 0, duration: 800, easing: ease, ...driver }),
      ])),
      ...values.dots.map((dot, i) => Animated.loop(Animated.sequence([
        Animated.delay(i * 150),
        Animated.timing(dot, { toValue: 1, duration: 240, easing: ease, ...driver }),
        Animated.timing(dot, { toValue: 0, duration: 240, easing: ease, ...driver }),
        Animated.delay(720 - i * 150),
      ]))),
    ];
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [reduceMotion, values]);

  useEffect(() => {
    if (!ready || reduceMotion === null) return;
    const animation = Animated.timing(values.exit, {
      toValue: 1, duration: reduceMotion ? 250 : EXIT_MS, easing: Easing.linear, ...driver,
    });
    // Reveal only once the app underneath has rendered, not an empty screen.
    const cancelIdle = whenJsIdle(() => animation.start(({ finished }) => { if (finished) onDone(); }));
    return () => { cancelIdle(); animation.stop(); };
  }, [onDone, ready, reduceMotion, values]);

  // `ready` only toggles touch-blocking on this plain View. The artwork is
  // memoised on stable props, so it does not re-render (and snap back) when
  // `ready` flips mid-animation.
  return (
    <View testID="launch-reveal" style={StyleSheet.absoluteFill} pointerEvents={ready ? 'none' : 'auto'}
      accessibilityLabel="Loading CatRealm" accessible>
      <LaunchArt values={values} reduceMotion={reduceMotion === true} />
    </View>
  );
}

/** Renders once per reduce-motion setting, before any animation starts. */
const LaunchArt = memo(function LaunchArt({ values, reduceMotion }: { values: LaunchValues; reduceMotion: boolean }) {
  const { intro, breathe, exit, dots } = values;
  const nodes = useMemo(() => {
    const fadeFirst = exit.interpolate({ inputRange: [0, 0.23], outputRange: [1, 0], extrapolate: 'clamp' });
    return {
      catScale: Animated.multiply(
        Animated.multiply(
          intro.interpolate({ inputRange: [0, 1], outputRange: [NATIVE_SPLASH_SIZE / CAT_SIZE, 1] }),
          breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }),
        ),
        reduceMotion
          ? 1
          : exit.interpolate(easedKeyframes([[0, 1], [0.2, 0.92], [1, 1.6]], Easing.in(Easing.quad))),
      ),
      catOpacity: exit.interpolate({ inputRange: [0, 0.2, 0.92], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
      backgroundOpacity: exit.interpolate({
        ...easedKeyframes([[0, 1], [0.23, 1], [0.85, 0]], Easing.out(Easing.cubic)), extrapolate: 'clamp',
      }),
      glowOpacity: Animated.multiply(
        Animated.multiply(breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }), intro),
        fadeFirst,
      ),
      glowScale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }),
      dotsOpacity: Animated.multiply(fadeFirst, intro),
      dots: dots.map((dot) => ({
        opacity: reduceMotion ? 0.6 : dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
        translateY: reduceMotion ? 0 : dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }),
      })),
    };
  }, [breathe, dots, exit, intro, reduceMotion]);

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: LAUNCH_BACKGROUND, opacity: nodes.backgroundOpacity }]} />
      <View style={styles.center}>
        <Animated.Image source={require('../../assets/launch-glow.png')} resizeMode="stretch"
          style={[styles.glow, { opacity: nodes.glowOpacity, transform: [{ scale: nodes.glowScale }] }]} />
        <Animated.View style={{ opacity: nodes.catOpacity, transform: [{ scale: nodes.catScale }] }}>
          <Image source={require('../../assets/launch-cat.png')} style={styles.cat} />
        </Animated.View>
        <Animated.View style={[styles.dots, { opacity: nodes.dotsOpacity }]}>
          {nodes.dots.map((dot, i) => (
            <Animated.View key={i} style={[styles.dot, { opacity: dot.opacity, transform: [{ translateY: dot.translateY }] }]} />
          ))}
        </Animated.View>
      </View>
    </>
  );
});

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: GLOW_SIZE, height: GLOW_SIZE },
  cat: { width: CAT_SIZE, height: CAT_SIZE },
  // Sits below the cat without shifting it off the native splash's centre.
  dots: { position: 'absolute', top: '50%', marginTop: CAT_SIZE / 2 + 22, flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: DOT_COLOR },
});
