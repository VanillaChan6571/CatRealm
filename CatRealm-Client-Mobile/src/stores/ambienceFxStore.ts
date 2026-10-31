import { create } from 'zustand';

// Only intent belongs in React state, not per-frame particle positions.
type AmbienceFxState = {
  spawning: boolean;
  startSpawning: () => void;
  stopSpawning: () => void;
};

export const useAmbienceFxStore = create<AmbienceFxState>((set) => ({
  spawning: false,
  startSpawning: () => set({ spawning: true }),
  stopSpawning: () => set({ spawning: false }),
}));
