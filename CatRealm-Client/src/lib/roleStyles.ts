import type { CSSProperties } from 'react';

const injectedAnimations = new Set<string>();

function hashColors(colors: string[]): string {
  let h = 0;
  const s = colors.join(',');
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function injectRgbFlowAnimation(colors: string[]): string {
  const name = `catrealm-rgb-${hashColors(colors)}`;
  if (injectedAnimations.has(name)) return name;
  injectedAnimations.add(name);

  // Build gradient stops with enough repetition for seamless loop
  const stops = [...colors, ...colors, colors[0]];
  const pct = stops.map((c, i) => `${c} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(', ');

  const style = document.createElement('style');
  style.textContent = `
    @keyframes ${name} {
      0%   { background-position: 0% 50%; }
      100% { background-position: 100% 50%; }
    }
    .${name} {
      background: linear-gradient(90deg, ${pct});
      background-size: 200% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
      animation: ${name} 3s linear infinite;
    }
  `;
  document.head.appendChild(style);
  return name;
}

function parseStyleColors(styleColors: string | null | undefined): string[] | null {
  if (!styleColors) return null;
  try {
    const parsed = JSON.parse(styleColors);
    if (Array.isArray(parsed) && parsed.length >= 2) return parsed as string[];
  } catch {
    // ignore
  }
  return null;
}

export function getRoleNameStyle(
  color: string | null | undefined,
  styleType: string | null | undefined,
  styleColors: string | null | undefined,
): CSSProperties {
  const type = styleType || 'solid';

  if (type === 'gradient') {
    const colors = parseStyleColors(styleColors);
    if (colors && colors.length >= 2) {
      const stops = colors.join(', ');
      return {
        backgroundImage: `linear-gradient(to right, ${stops})`,
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        color: 'transparent',
      };
    }
  }

  if (type === 'glow' && color) {
    return {
      color,
      textShadow: `0 0 8px ${color}, 0 0 20px ${color}`,
    };
  }

  if (type === 'rgb_flow') {
    const colors = parseStyleColors(styleColors);
    if (colors && colors.length >= 2 && typeof document !== 'undefined') {
      // Return className hint via data attribute trick — caller must apply className
      // Instead, we inject a <style> and return the animation via inline style using background
      const stops = [...colors, ...colors, colors[0]];
      const pct = stops.map((c, i) => `${c} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(', ');
      const animName = injectRgbFlowAnimation(colors);
      return {
        backgroundImage: `linear-gradient(90deg, ${pct})`,
        backgroundSize: '200% 100%',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        color: 'transparent',
        animation: `${animName} 3s linear infinite`,
      };
    }
  }

  // solid (default)
  return color ? { color } : {};
}

/**
 * Returns the effective primary hex color for a role, accounting for style type.
 * For gradient/rgb_flow the first stop color is used so SVG icons (which can't use
 * background-clip: text) still get the role's actual color rather than the legacy solid field.
 */
export function getRolePrimaryColor(
  color: string | null | undefined,
  styleType: string | null | undefined,
  styleColors: string | null | undefined,
): string | undefined {
  const type = styleType || 'solid';
  if (type === 'gradient' || type === 'rgb_flow') {
    const colors = parseStyleColors(styleColors);
    if (colors && colors.length >= 1) return colors[0];
  }
  return color || undefined;
}

/** Returns className string for rgb_flow animation (for use in className prop). */
export function getRgbFlowClassName(styleColors: string | null | undefined): string {
  const colors = parseStyleColors(styleColors);
  if (!colors || colors.length < 2 || typeof document === 'undefined') return '';
  return injectRgbFlowAnimation(colors);
}
