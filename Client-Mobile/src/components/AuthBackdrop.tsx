import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from '@/components/SafeAreaView';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

type StarPoint = readonly [number, number, number, number, string];

const STAR_RADIUS_SCALE = 0.58;
const STAR_TILE_SCALE = 1.55;

const starLayers = [
  {
    width: 280,
    height: 140,
    opacity: 0.72,
    points: [
      [14, 26, 1.4, 0.9, '#FFFFFF'],
      [42, 82, 1, 0.84, '#DEE5FF'],
      [88, 36, 1.8, 0.78, '#D6C3FF'],
      [110, 18, 2.8, 0.78, '#FFFFFF'],
      [124, 104, 1.2, 0.74, '#C5F1FF'],
      [168, 60, 1, 0.84, '#FFFFFF'],
      [202, 20, 1.6, 0.74, '#D7C9FF'],
      [228, 72, 2.4, 0.76, '#C6EFFF'],
      [236, 96, 1, 0.76, '#BAF5FF'],
      [264, 52, 1.4, 0.8, '#FFFFFF'],
    ] as readonly StarPoint[],
  },
  {
    width: 300,
    height: 120,
    opacity: 0.54,
    points: [
      [22, 48, 1.4, 0.78, '#FFFFFF'],
      [58, 20, 1, 0.72, '#BDA8FF'],
      [102, 84, 1.8, 0.8, '#C2F0FF'],
      [132, 26, 2.6, 0.76, '#D5C6FF'],
      [144, 56, 1, 0.72, '#FFFFFF'],
      [182, 10, 1.6, 0.72, '#CDBCFF'],
      [214, 92, 2.3, 0.74, '#BDEFFF'],
      [226, 72, 1, 0.7, '#C2F0FF'],
      [268, 38, 1.2, 0.72, '#FFFFFF'],
    ] as readonly StarPoint[],
  },
  {
    width: 290,
    height: 110,
    opacity: 0.44,
    points: [
      [34, 18, 1.2, 0.74, '#FFFFFF'],
      [74, 68, 1.7, 0.72, '#B39AFF'],
      [96, 42, 2.5, 0.72, '#FFFFFF'],
      [114, 42, 1, 0.68, '#C5E8FF'],
      [154, 90, 1.4, 0.7, '#FFFFFF'],
      [176, 14, 2.2, 0.7, '#C6EDFF'],
      [198, 28, 1, 0.66, '#C5E8FF'],
      [234, 78, 1.6, 0.68, '#B39AFF'],
      [254, 96, 2.4, 0.68, '#C9BAFF'],
      [272, 50, 1, 0.72, '#FFFFFF'],
    ] as readonly StarPoint[],
  },
] as const;

function buildTiledStarLayers(width: number, height: number) {
  return starLayers.map((layer, li) => {
    const tileWidth = layer.width * STAR_TILE_SCALE;
    const tileHeight = layer.height * STAR_TILE_SCALE;
    const ox = li * 18 * STAR_TILE_SCALE;
    const oy = li * 11 * STAR_TILE_SCALE;
    const stars: Array<readonly [string, number, number, number, number, string]> = [];
    let row = 0;
    for (let by = -tileHeight; by < height + tileHeight; by += tileHeight, row++) {
      let col = 0;
      for (let bx = -tileWidth; bx < width + tileWidth; bx += tileWidth, col++) {
        layer.points.forEach(([cx, cy, r, opacity, color], pi) => {
          stars.push([
            `${li}-${col}-${row}-${pi}`,
            bx + ox + cx * STAR_TILE_SCALE,
            by + oy + cy * STAR_TILE_SCALE,
            r * STAR_RADIUS_SCALE,
            opacity * layer.opacity,
            color,
          ]);
        });
      }
    }
    return stars;
  });
}

export function AuthBackdrop({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const tiledStarLayers = useMemo(() => buildTiledStarLayers(width, height), [width, height]);
  const orbAProgress = useRef(new Animated.Value(0)).current;
  const orbBProgress = useRef(new Animated.Value(0)).current;
  // Initial values match the 0%/100% keyframe of each desktop twinkle animation
  const starOpacity = useRef([
    new Animated.Value(0.62),
    new Animated.Value(0.56),
    new Animated.Value(0.5),
  ]).current;
  const starScale = useRef([
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;

  useEffect(() => {
    const orbA = Animated.loop(
      Animated.sequence([
        Animated.timing(orbAProgress, {
          toValue: 1,
          duration: 20000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(orbAProgress, {
          toValue: 0,
          duration: 20000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    const orbB = Animated.loop(
      Animated.sequence([
        Animated.timing(orbBProgress, {
          toValue: 1,
          duration: 23000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(orbBProgress, {
          toValue: 0,
          duration: 23000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    // Layer 0 — inviteTwinkle1 (7.4s), starts immediately
    const layer0 = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(starOpacity[0], { toValue: 0.82, duration: 1924, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[0], { toValue: 0.98, duration: 592, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[0], { toValue: 0.76, duration: 2220, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[0], { toValue: 0.92, duration: 1258, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[0], { toValue: 0.62, duration: 1406, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(starScale[0], { toValue: 1.01, duration: 2516, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starScale[0], { toValue: 1.005, duration: 3478, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starScale[0], { toValue: 1, duration: 1406, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ]),
    );

    // Layer 1 — inviteTwinkle2 (6.1s), starts after ~40% of its cycle so it is
    // always at a different depth than layer 0
    const layer1 = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(starOpacity[1], { toValue: 0.74, duration: 1342, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[1], { toValue: 0.9, duration: 366, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[1], { toValue: 0.7, duration: 2196, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[1], { toValue: 0.84, duration: 1342, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[1], { toValue: 0.56, duration: 854, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(starScale[1], { toValue: 1.012, duration: 1708, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starScale[1], { toValue: 1.006, duration: 3538, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starScale[1], { toValue: 1, duration: 854, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ]),
    );

    // Layer 2 — inviteTwinkle3 (8.9s), starts after ~56% of its cycle
    const layer2 = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(starOpacity[2], { toValue: 0.62, duration: 1602, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[2], { toValue: 0.84, duration: 2403, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[2], { toValue: 0.64, duration: 2225, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[2], { toValue: 0.78, duration: 1869, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starOpacity[2], { toValue: 0.5, duration: 801, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(starScale[2], { toValue: 1.01, duration: 4005, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starScale[2], { toValue: 1.004, duration: 4094, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(starScale[2], { toValue: 1, duration: 801, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ]),
    );

    orbA.start();
    orbB.start();
    layer0.start();
    const t1 = setTimeout(() => layer1.start(), 2500);
    const t2 = setTimeout(() => layer2.start(), 5000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      orbA.stop();
      orbB.stop();
      layer0.stop();
      layer1.stop();
      layer2.stop();
    };
  }, [orbAProgress, orbBProgress, starOpacity, starScale]);

  const orbATransform = {
    transform: [
      {
        translateX: orbAProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 32],
        }),
      },
      {
        translateY: orbAProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -34],
        }),
      },
      {
        scale: orbAProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.08],
        }),
      },
    ],
  };
  const orbBTransform = {
    transform: [
      {
        translateX: orbBProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -30],
        }),
      },
      {
        translateY: orbBProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 26],
        }),
      },
      {
        scale: orbBProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.06],
        }),
      },
    ],
  };

  return (
    <LinearGradient
      colors={['#22183A', '#171225', '#171225']}
      locations={[0, 0.48, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.root}
    >
      {/* Ambient radial glows. Radius is capped so landscape mode doesn't wash the
          whole screen — desktop uses a fixed 1200px radius at 1440px viewport width,
          so we scale proportionally and cap to avoid the landscape hue bleed. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient
            id="bgPurple"
            cx={width * 0.12}
            cy={-height * 0.08}
            r={Math.min(width * 0.7, 480)}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0%" stopColor="#7C5CFF" stopOpacity="0.18" />
            <Stop offset="60%" stopColor="#7C5CFF" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient
            id="bgCyan"
            cx={width * 0.92}
            cy={height * 0.08}
            r={Math.min(width * 0.55, 360)}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0%" stopColor="#67E8F9" stopOpacity="0.08" />
            <Stop offset="60%" stopColor="#67E8F9" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#bgPurple)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#bgCyan)" />
      </Svg>

      <Animated.View pointerEvents="none" style={[styles.orbA, orbATransform]}>
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 420 420">
          <Defs>
            <RadialGradient id="authOrbA" cx="35%" cy="35%" r="62%">
              <Stop offset="0%" stopColor="#7C5CFF" stopOpacity="0.34" />
              <Stop offset="55%" stopColor="#7C5CFF" stopOpacity="0.08" />
              <Stop offset="100%" stopColor="#7C5CFF" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="210" cy="210" r="210" fill="url(#authOrbA)" />
        </Svg>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.orbB, orbBTransform]}>
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 360 360">
          <Defs>
            <RadialGradient id="authOrbB" cx="45%" cy="45%" r="64%">
              <Stop offset="0%" stopColor="#67E8F9" stopOpacity="0.2" />
              <Stop offset="55%" stopColor="#67E8F9" stopOpacity="0.06" />
              <Stop offset="100%" stopColor="#67E8F9" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="180" cy="180" r="180" fill="url(#authOrbB)" />
        </Svg>
      </Animated.View>

      {tiledStarLayers.map((stars, layerIndex) => (
        <Animated.View
          key={`stars-${layerIndex}`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width,
            height,
            opacity: starOpacity[layerIndex],
            transform: [
              { scale: starScale[layerIndex] },
            ],
          }}
        >
          <Svg width={width} height={height}>
            {stars.map(([key, cx, cy, r, opacity, color]) => (
              <Circle key={key} cx={cx} cy={cy} r={r} fill={color} opacity={opacity} />
            ))}
          </Svg>
        </Animated.View>
      ))}

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>{children}</View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#171225',
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    zIndex: 1,
  },
  orbA: {
    position: 'absolute',
    width: 420,
    height: 420,
    left: -220,
    bottom: -150,
    opacity: 0.9,
  },
  orbB: {
    position: 'absolute',
    width: 360,
    height: 360,
    right: -210,
    top: 56,
    opacity: 0.82,
  },
});
