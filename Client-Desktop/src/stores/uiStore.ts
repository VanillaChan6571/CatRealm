import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { RealtimeReconnectKind } from '../lib/realtimeReconnect';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
export type FullscreenView = 'socialProfileEditor';

export type RealtimeReconnectPrompt = {
  kind: RealtimeReconnectKind;
  serverUrl: string;
  channelId: string;
  channelName: string | null;
};

interface UIState {
  sidebarOpen: boolean;
  memberListOpen: boolean;
  voiceChatOpen: boolean;
  serverListOpen: boolean;
  mobileNavOpen: boolean;
  connectionStatus: ConnectionStatus;
  serverRestartPending: boolean;
  realtimeReconnectPrompt: RealtimeReconnectPrompt | null;
  sslBlockedServerUrl: string | null;
  realmTrustPromptUrl: string | null;
  activeModal: string | null;
  modalData: unknown;
  activeFullscreenView: FullscreenView | null;
  activeDrawer: string | null;
  createInviteModalOpen: boolean;
  voiceBarRetracted: boolean;
  voiceStreamListCollapsed: boolean;
  voiceStreamListRestorable: boolean;
  theaterBarRetracted: boolean;
  theaterSidePanelRetracted: boolean;

  toggleSidebar: () => void;
  toggleMemberList: () => void;
  toggleVoiceChat: () => void;
  toggleServerList: () => void;
  setMobileNavOpen: (open: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setServerRestartPending: (pending: boolean) => void;
  setRealtimeReconnectPrompt: (prompt: RealtimeReconnectPrompt | null) => void;
  clearRealtimeReconnectPrompt: () => void;
  setSslBlockedServerUrl: (url: string | null) => void;
  setRealmTrustPromptUrl: (url: string | null) => void;
  openModal: (name: string, data?: unknown) => void;
  closeModal: () => void;
  openFullscreenView: (view: FullscreenView) => void;
  closeFullscreenView: () => void;
  openDrawer: (name: string) => void;
  closeDrawer: () => void;
  setCreateInviteModalOpen: (open: boolean) => void;
  toggleVoiceBarRetracted: () => void;
  setVoiceBarRetracted: (retracted: boolean) => void;
  setVoiceStreamListCollapsed: (collapsed: boolean) => void;
  setVoiceStreamListRestorable: (restorable: boolean) => void;
  toggleTheaterBarRetracted: () => void;
  setTheaterBarRetracted: (retracted: boolean) => void;
  toggleTheaterSidePanelRetracted: () => void;
  setTheaterSidePanelRetracted: (retracted: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
      memberListOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
      voiceChatOpen: false,
      serverListOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
      mobileNavOpen: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
      connectionStatus: 'disconnected',
      serverRestartPending: false,
      realtimeReconnectPrompt: null,
      sslBlockedServerUrl: null,
      realmTrustPromptUrl: null,
      activeModal: null,
      modalData: null,
      activeFullscreenView: null,
      activeDrawer: null,
      createInviteModalOpen: false,
      voiceBarRetracted: false,
      voiceStreamListCollapsed: false,
      voiceStreamListRestorable: false,
      theaterBarRetracted: false,
      theaterSidePanelRetracted: false,

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleMemberList: () => set((s) => ({ memberListOpen: !s.memberListOpen })),
      toggleVoiceChat: () => set((s) => ({ voiceChatOpen: !s.voiceChatOpen })),
      toggleServerList: () => set((s) => ({ serverListOpen: !s.serverListOpen })),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
      setServerRestartPending: (serverRestartPending) => set({ serverRestartPending }),
      setRealtimeReconnectPrompt: (realtimeReconnectPrompt) => set({ realtimeReconnectPrompt }),
      clearRealtimeReconnectPrompt: () => set({ realtimeReconnectPrompt: null }),
      setSslBlockedServerUrl: (sslBlockedServerUrl) => set({ sslBlockedServerUrl }),
      setRealmTrustPromptUrl: (realmTrustPromptUrl) => set({ realmTrustPromptUrl }),
      openModal: (activeModal, modalData = null) =>
        set({ activeModal, modalData, activeDrawer: null }),
      closeModal: () => set({ activeModal: null, modalData: null }),
      openFullscreenView: (activeFullscreenView) =>
        set({ activeFullscreenView, activeModal: null, modalData: null, activeDrawer: null }),
      closeFullscreenView: () => set({ activeFullscreenView: null }),
      openDrawer: (activeDrawer) =>
        set({ activeDrawer, activeModal: null, modalData: null }),
      closeDrawer: () => set({ activeDrawer: null }),
      setCreateInviteModalOpen: (createInviteModalOpen) => set({ createInviteModalOpen }),
      toggleVoiceBarRetracted: () => set((s) => ({ voiceBarRetracted: !s.voiceBarRetracted })),
      setVoiceBarRetracted: (voiceBarRetracted) => set({ voiceBarRetracted }),
      setVoiceStreamListCollapsed: (voiceStreamListCollapsed) => set({ voiceStreamListCollapsed }),
      setVoiceStreamListRestorable: (voiceStreamListRestorable) => set({ voiceStreamListRestorable }),
      toggleTheaterBarRetracted: () => set((s) => ({ theaterBarRetracted: !s.theaterBarRetracted })),
      setTheaterBarRetracted: (theaterBarRetracted) => set({ theaterBarRetracted }),
      toggleTheaterSidePanelRetracted: () => set((s) => ({ theaterSidePanelRetracted: !s.theaterSidePanelRetracted })),
      setTheaterSidePanelRetracted: (theaterSidePanelRetracted) => set({ theaterSidePanelRetracted }),
    }),
    {
      name: 'catrealm-ui-preferences',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        voiceBarRetracted: state.voiceBarRetracted,
        theaterBarRetracted: state.theaterBarRetracted,
        theaterSidePanelRetracted: state.theaterSidePanelRetracted,
      }),
    },
  ),
);
