import { AMBIENCE_SPAWN_RATE, MAX_AMBIENCE_PARTICLES, ambienceParticleMotion } from '../ambienceParticles';

test('preserves particle density and the original motion ranges', () => {
  expect(MAX_AMBIENCE_PARTICLES).toBe(80);
  expect(AMBIENCE_SPAWN_RATE).toBe(5.5);
  for (let i = 0; i < 1000; i++) {
    const { from, to, duration } = ambienceParticleMotion(100, 100);
    expect(from.x).toBeGreaterThanOrEqual(6);
    expect(from.x).toBeLessThanOrEqual(94);
    expect(from.y).toBeGreaterThanOrEqual(100);
    expect(from.y).toBeLessThanOrEqual(112);
    const seconds = duration / 1000;
    expect((from.y - to.y) / seconds).toBeGreaterThanOrEqual(10 - 1e-9);
    expect((from.y - to.y) / seconds).toBeLessThanOrEqual(24 + 1e-9);
    expect(Math.abs((to.x - from.x) / seconds)).toBeLessThanOrEqual(2.5 + 1e-9);
    expect(Math.min(Math.abs(to.y + 8), Math.abs(to.x + 10), Math.abs(to.x - 110))).toBeLessThan(1e-9);
  }
});
