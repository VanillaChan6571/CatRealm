/**
 * The layer drawn behind a tracker's or board's content: one of the voice-call colour patterns,
 * or an image. Mirrors desktop's WorkChannelBackdrop. Animated patterns and their decorative
 * scenes (rings, orbit, particles, pixels) are drawn as the still pattern on mobile.
 */

import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { BoardBackground } from '@/types';
import { resolveRealmUrl } from './workItemUtils';

type PatternBackground = Extract<BoardBackground, { kind: 'pattern' }>;

/** The bar behind a backdrop's headers so they stay readable. Darker than desktop's bg-black/25, which also blurs. */
export const BACKDROP_BAR_COLOR = 'rgba(0, 0, 0, 0.55)';

const DEFAULT_COLORS = ['#3a418f', '#23274f', '#16182d'];
const DEFAULT_OFFSETS = [0, 0.45, 1];
const STRIPE_BAND = 56;
const MESH_ANCHORS: Array<[number, number]> = [[0.15, 0.1], [0.85, 0.15], [0.2, 0.85], [0.8, 0.8], [0.5, 0.4], [0.5, 0.95]];

export const WorkChannelBackdrop = memo(function WorkChannelBackdrop({ background, serverUrl, defaultImagePositionX = 50 }: {
  background: BoardBackground | null;
  serverUrl: string | null | undefined;
  defaultImagePositionX?: number;
}) {
  if (!background) return null;
  if (background.kind === 'image') {
    const uri = resolveRealmUrl(background.image, serverUrl);
    if (!uri) return null;
    return (
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        cachePolicy="memory-disk"
        contentFit={background.stretch ? 'fill' : background.fit ? 'contain' : 'cover'}
        contentPosition={{ left: `${background.positionX ?? defaultImagePositionX}%`, top: `${background.positionY ?? 50}%` }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return <PatternLayer background={background} />;
});

function PatternLayer({ background }: { background: PatternBackground }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const valid = background.colors.filter((color) => /^#[0-9a-fA-F]{6}$/.test(color));

  if (valid.length === 1) {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: valid[0] }]} />;
  }
  const colors = valid.length ? valid : DEFAULT_COLORS;
  const pattern = valid.length ? background.pattern : 'radial';
  const offsets = valid.length ? colors.map((_, i) => i / (colors.length - 1)) : DEFAULT_OFFSETS;
  const stops = colors.map((color, i) => <Stop key={i} offset={offsets[i]} stopColor={color} />);

  const draw = (width: number, height: number) => {
    switch (pattern) {
      case 'linear':
      case 'diagonal': {
        const points = cssLinearPoints(pattern === 'linear' ? 180 : 135, width, height);
        return [<LinearGradient key="g" id="bg" gradientUnits="userSpaceOnUse" {...points}>{stops}</LinearGradient>, 'url(#bg)'] as const;
      }
      case 'stripes':
        // Drawn as polygons below.
        return [null, colors[0]] as const;
      case 'mesh':
        return [null, colors[colors.length - 1]] as const;
      case 'radial':
      default: {
        const cx = 0.2 * width;
        return [
          <RadialGradient key="g" id="bg" gradientUnits="userSpaceOnUse" cx={cx} cy={0} fx={cx} fy={0} r={farthestCorner(cx, 0, width, height)}>{stops}</RadialGradient>,
          'url(#bg)',
        ] as const;
      }
    }
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => {
      const { width, height } = e.nativeEvent.layout;
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    }}>
      {size ? (() => {
        const { width, height } = size;
        const [def, fill] = draw(width, height);
        // Mesh: soft blobs of each colour around the edges over the last colour.
        const blobs = pattern === 'mesh' ? colors.slice(0, MESH_ANCHORS.length).map((color, i) => {
          const cx = MESH_ANCHORS[i][0] * width;
          const cy = MESH_ANCHORS[i][1] * height;
          return { color, cx, cy, r: farthestCorner(cx, cy, width, height) };
        }) : [];
        return (
          <Svg width={width} height={height}>
            <Defs>
              {def}
              {blobs.map((blob, i) => (
                <RadialGradient key={i} id={`blob${i}`} gradientUnits="userSpaceOnUse" cx={blob.cx} cy={blob.cy} fx={blob.cx} fy={blob.cy} r={blob.r}>
                  <Stop offset={0} stopColor={blob.color} stopOpacity={1} />
                  <Stop offset={0.55} stopColor={blob.color} stopOpacity={0} />
                </RadialGradient>
              ))}
            </Defs>
            <Rect x={0} y={0} width={width} height={height} fill={fill} />
            {pattern === 'stripes' ? <Stripes colors={colors} width={width} height={height} /> : null}
            {blobs.map((_, i) => <Rect key={i} x={0} y={0} width={width} height={height} fill={`url(#blob${i})`} />)}
          </Svg>
        );
      })() : null}
    </View>
  );
}

/**
 * CSS repeating-linear-gradient(45deg, ...) with one band per colour. Each band is the strip
 * between two lines x - y = c, drawn as a polygon in screen space; react-native-svg drew rotated
 * groups and pattern tiles as clipped triangles.
 */
function Stripes({ colors, width, height }: { colors: string[]; width: number; height: number }) {
  const step = STRIPE_BAND * Math.SQRT2;
  const bands: Array<{ points: string; color: string }> = [];
  // The gradient starts at the bottom-left corner, where x - y = -height.
  for (let k = 0, c = -height; c < width; k += 1, c += step) {
    const c2 = c + step + 0.5;
    bands.push({ points: `${c},0 ${c2},0 ${c2 + height},${height} ${c + height},${height}`, color: colors[k % colors.length] });
  }
  return <>{bands.map((band, i) => <Polygon key={i} points={band.points} fill={band.color} />)}</>;
}

/** CSS circle radius for `farthest-corner` from (cx, cy). */
function farthestCorner(cx: number, cy: number, width: number, height: number) {
  return Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
}

/** The start and end of a CSS `linear-gradient(<angle>deg, ...)` line over a width x height box. */
function cssLinearPoints(angleDeg: number, width: number, height: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  return {
    x1: width / 2 - dx * half, y1: height / 2 - dy * half,
    x2: width / 2 + dx * half, y2: height / 2 + dy * half,
  };
}
