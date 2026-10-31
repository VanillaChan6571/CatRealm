import { create } from 'zustand';

interface GameActivityStoreState {
  detectorState: DesktopGameActivityState;
  effectiveGameStartedAt: number | null;
  gameIconUrl: string | null;
  setDetectorState: (state: Partial<DesktopGameActivityState> | null | undefined) => void;
  setEffectiveGameStartedAt: (v: number | null) => void;
  setGameIconUrl: (url: string | null) => void;
}

const DEFAULT_STATE: DesktopGameActivityState = {
  supported: false,
  enabled: false,
  status: 'unsupported',
  activity: null,
  lastError: null,
  updatedAt: 0,
};

function normalizeDetectorState(state: Partial<DesktopGameActivityState> | null | undefined): DesktopGameActivityState {
  return {
    supported: state?.supported ?? DEFAULT_STATE.supported,
    enabled: state?.enabled ?? DEFAULT_STATE.enabled,
    status: state?.status ?? DEFAULT_STATE.status,
    activity: state?.activity ?? DEFAULT_STATE.activity,
    lastError: state?.lastError ?? DEFAULT_STATE.lastError,
    updatedAt: state?.updatedAt ?? Date.now(),
  };
}

export const useGameActivityStore = create<GameActivityStoreState>((set) => ({
  detectorState: DEFAULT_STATE,
  effectiveGameStartedAt: null,
  gameIconUrl: null,
  setDetectorState: (detectorState) => set({ detectorState: normalizeDetectorState(detectorState) }),
  setEffectiveGameStartedAt: (effectiveGameStartedAt) => set({ effectiveGameStartedAt }),
  setGameIconUrl: (gameIconUrl) => set({ gameIconUrl }),
}));
