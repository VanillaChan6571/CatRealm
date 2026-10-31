import { create } from 'zustand';

type DMKeyReverificationState = {
  accountId: string | null;
  recentPasskeyApprovedDeviceId: string | null;
  waitingDeviceId: string | null;
  setAccountId: (accountId: string | null) => void;
  notePasskeyApprovedDevice: (accountId: string, deviceId: string) => void;
  markProofRequired: (accountId: string, targetDeviceIds: string[]) => void;
  clearForTargets: (accountId: string, targetDeviceIds: string[]) => void;
};

export const useDMKeyReverificationStore = create<DMKeyReverificationState>((set) => ({
  accountId: null,
  recentPasskeyApprovedDeviceId: null,
  waitingDeviceId: null,
  setAccountId: (accountId) => set((state) => state.accountId === accountId ? state : {
    accountId,
    recentPasskeyApprovedDeviceId: null,
    waitingDeviceId: null,
  }),
  notePasskeyApprovedDevice: (accountId, deviceId) => set((state) => state.accountId === accountId
    ? { recentPasskeyApprovedDeviceId: deviceId }
    : state),
  markProofRequired: (accountId, targetDeviceIds) => set((state) => state.accountId === accountId
    && state.recentPasskeyApprovedDeviceId
    && targetDeviceIds.includes(state.recentPasskeyApprovedDeviceId)
      ? { waitingDeviceId: state.recentPasskeyApprovedDeviceId }
      : state),
  clearForTargets: (accountId, targetDeviceIds) => set((state) => state.accountId === accountId
    && state.waitingDeviceId
    && targetDeviceIds.includes(state.waitingDeviceId)
      ? { waitingDeviceId: null, recentPasskeyApprovedDeviceId: null }
      : state),
}));
