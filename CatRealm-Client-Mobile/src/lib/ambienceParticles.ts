export const MAX_AMBIENCE_PARTICLES = 80;
export const AMBIENCE_SPAWN_RATE = 5.5;
export const AMBIENCE_COLORS = ['#f9a8ff', '#d8b4fe', '#ffffff', '#22d3ee'];

/** Same starting positions, speeds, and exit boundaries as the JS simulation. */
export function ambienceParticleMotion(width: number, height: number) {
  const x = 6 + Math.random() * 88;
  const y = 100 + Math.random() * 12;
  const vx = (Math.random() - 0.5) * 5;
  const vy = 10 + Math.random() * 14;
  const verticalLifetime = (y + 8) / vy;
  const horizontalLifetime = vx > 0 ? (110 - x) / vx : vx < 0 ? (-10 - x) / vx : Infinity;
  const seconds = Math.min(verticalLifetime, horizontalLifetime);
  return {
    from: { x: x * width / 100, y: y * height / 100 },
    to: { x: (x + vx * seconds) * width / 100, y: (y - vy * seconds) * height / 100 },
    duration: seconds * 1000,
  };
}
