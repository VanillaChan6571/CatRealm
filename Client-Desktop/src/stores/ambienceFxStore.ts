import { create } from 'zustand';

type Pixel = {
  id: number;
  xPct: number;
  sizePx: number;
  color: string;
  driftVw: number;
  durationSec: number;
  expiresAt: number;
};

type State = {
  pixels: Pixel[];
  spawning: boolean;
  startSpawning: () => void;
  stopSpawning: () => void;
  tick: (dtSec: number, options?: { maxPixels?: number; spawnRatePerSec?: number }) => void;
};

const COLORS = ['#f9a8ff', '#d8b4fe', '#ffffff', '#22d3ee'];
const MAX_PIXELS = 24;
let nextId = 1;
let spawnBudget = 0;

function makePixel(now: number): Pixel {
  const durationSec = 4 + Math.random() * 3;
  return {
    id: nextId++,
    xPct: 8 + Math.random() * 84,
    sizePx: 2 + Math.random() * 3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? '#ffffff',
    driftVw: (Math.random() - 0.5) * 7,
    durationSec,
    expiresAt: now + durationSec * 1000 + 250,
  };
}

export const useAmbienceFxStore = create<State>((set, get) => ({
  pixels: [],
  spawning: false,
  startSpawning: () => set({ spawning: true }),
  stopSpawning: () => {
    spawnBudget = 0;
    set({ spawning: false });
  },
  tick: (dtSec, options) => {
    if (dtSec <= 0) return;
    const maxPixels = Math.max(1, options?.maxPixels ?? MAX_PIXELS);
    const spawnRatePerSec = Math.max(0, options?.spawnRatePerSec ?? 3);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (get().spawning) {
      spawnBudget += dtSec * spawnRatePerSec;
      const availableSlots = Math.max(0, maxPixels - get().pixels.length);
      const count = Math.min(Math.ceil(spawnRatePerSec), availableSlots, Math.floor(spawnBudget));
      if (count > 0) {
        spawnBudget -= count;
        set((state) => ({
          pixels: [...state.pixels, ...Array.from({ length: count }, () => makePixel(now))],
        }));
      }
    }

    set((state) => ({
      pixels: state.pixels.filter((p) => p.expiresAt > now),
    }));
  },
}));

