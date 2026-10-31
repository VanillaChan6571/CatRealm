function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const m = light - c / 2;
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function isBrownLikeHue(hue: number): boolean {
  // Avoid orange/brown ranges for the fallback background.
  return (hue >= 15 && hue <= 48);
}

export function groupChatFallbackBackground(seed: string): string {
  const hash = hashSeed(seed || 'group-chat');
  let hue = hash % 360;
  let attempts = 0;
  while (isBrownLikeHue(hue) && attempts < 12) {
    hue = (hue + 37) % 360;
    attempts += 1;
  }

  // Keep saturation/lightness in colorful mid-ranges to avoid gray/black/white.
  const saturation = 68 + ((hash >>> 9) % 18); // 68-85
  const lightness = 42 + ((hash >>> 17) % 14); // 42-55
  return hslToHex(hue, saturation, lightness);
}

