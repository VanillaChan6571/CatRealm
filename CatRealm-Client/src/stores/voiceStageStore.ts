import { create } from 'zustand';

type StateUpdate<T> = T | ((current: T) => T);

type VoiceStageState = {
  joinedRemoteStreamIds: string[];
  selectedStageStreamId: string | null;
  streamAudioVolumeById: Record<string, number>;
  setJoinedRemoteStreamIds: (next: StateUpdate<string[]>) => void;
  setSelectedStageStreamId: (next: StateUpdate<string | null>) => void;
  setStreamAudioVolume: (streamId: string, volumePct: number) => void;
  clearVoiceStage: () => void;
};

function resolveStateUpdate<T>(current: T, next: StateUpdate<T>) {
  return typeof next === 'function' ? (next as (current: T) => T)(current) : next;
}

function clampStreamAudioVolume(volumePct: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(volumePct) ? volumePct : 100)));
}

export const useVoiceStageStore = create<VoiceStageState>((set) => ({
  joinedRemoteStreamIds: [],
  selectedStageStreamId: null,
  streamAudioVolumeById: {},

  setJoinedRemoteStreamIds: (next) => {
    set((state) => ({
      joinedRemoteStreamIds: Array.from(new Set(resolveStateUpdate(state.joinedRemoteStreamIds, next))),
    }));
  },

  setSelectedStageStreamId: (next) => {
    set((state) => ({
      selectedStageStreamId: resolveStateUpdate(state.selectedStageStreamId, next),
    }));
  },

  setStreamAudioVolume: (streamId, volumePct) => {
    set((state) => ({
      streamAudioVolumeById: {
        ...state.streamAudioVolumeById,
        [streamId]: clampStreamAudioVolume(volumePct),
      },
    }));
  },

  clearVoiceStage: () => {
    set({
      joinedRemoteStreamIds: [],
      selectedStageStreamId: null,
      streamAudioVolumeById: {},
    });
  },
}));
