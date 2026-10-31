/**
 * UI store — global UI flags (modals, drawers, theme overrides, debug).
 * Mirrors CatRealm-Client/src/stores/uiStore.ts.
 */

import { create } from 'zustand';

export interface MediaViewerItem {
  url: string;
  name?: string | null;
  /** Set when the URL has no telling extension (e.g. /api/embed-media?token=). */
  kind?: 'image' | 'video';
}

export type NavigationDrawer = 'servers' | 'channels';

export interface UIState {
  closingDrawer: NavigationDrawer | null;
  pendingDrawer: NavigationDrawer | null;
  finishDrawerClose: (drawer: NavigationDrawer) => void;
  serverDrawerOpen: boolean;
  channelsSheetOpen: boolean;
  membersSheetOpen: boolean;
  searchOpen: boolean;
  threadsOpen: boolean;
  activeChannelId: string | null;
  mediaViewerOpen: boolean;
  mediaViewerUrl: string | null;
  mediaViewerName: string | null;
  mediaViewerItems: MediaViewerItem[];
  mediaViewerIndex: number;
  profileEditMode: boolean;
  /** Theater the user tapped but has not joined; drives the join modal. */
  theaterPrompt: { serverId: string; channelId: string; channelName?: string } | null;

  setServerDrawerOpen: (v: boolean) => void;
  toggleServerDrawer: () => void;
  setChannelsSheetOpen: (v: boolean) => void;
  setMembersSheetOpen: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  setThreadsOpen: (v: boolean) => void;
  setActiveChannelId: (id: string | null) => void;
  setProfileEditMode: (v: boolean) => void;
  setTheaterPrompt: (prompt: UIState['theaterPrompt']) => void;
  openMediaViewer: (url: string, name?: string | null, items?: MediaViewerItem[], index?: number) => void;
  setMediaViewerIndex: (index: number) => void;
  closeMediaViewer: () => void;
  closeAll: () => void;
}

// Requests made during an exit update the destination; only animation completion
// may open it. This also handles multiple taps batched into one React render.
function requestedDrawer(s: UIState): NavigationDrawer | null {
  return s.closingDrawer ? s.pendingDrawer
    : s.serverDrawerOpen ? 'servers' : s.channelsSheetOpen ? 'channels' : null;
}

function requestDrawer(s: UIState, next: NavigationDrawer | null): Partial<UIState> {
  if (s.closingDrawer) return { pendingDrawer: next };
  const current = requestedDrawer(s);
  if (current && current !== next) {
    return { serverDrawerOpen: false, channelsSheetOpen: false, closingDrawer: current, pendingDrawer: next };
  }
  return { serverDrawerOpen: next === 'servers', channelsSheetOpen: next === 'channels' };
}

export const useUIStore = create<UIState>((set) => ({
  closingDrawer: null,
  pendingDrawer: null,
  serverDrawerOpen: false,
  channelsSheetOpen: false,
  membersSheetOpen: false,
  searchOpen: false,
  threadsOpen: false,
  activeChannelId: null,
  mediaViewerOpen: false,
  mediaViewerUrl: null,
  mediaViewerName: null,
  mediaViewerItems: [],
  mediaViewerIndex: 0,
  profileEditMode: false,
  theaterPrompt: null,

  setServerDrawerOpen: (v) => set((s) => v
    ? requestDrawer(s, 'servers')
    : requestedDrawer(s) === 'servers' ? requestDrawer(s, null) : s),
  toggleServerDrawer: () => set((s) => requestDrawer(s, requestedDrawer(s) === 'servers' ? null : 'servers')),
  setChannelsSheetOpen: (v) => set((s) => v
    ? requestDrawer(s, 'channels')
    : requestedDrawer(s) === 'channels' ? requestDrawer(s, null) : s),
  finishDrawerClose: (drawer) => set((s) => s.closingDrawer !== drawer ? s : {
    serverDrawerOpen: s.pendingDrawer === 'servers',
    channelsSheetOpen: s.pendingDrawer === 'channels',
    closingDrawer: null,
    pendingDrawer: null,
  }),
  setMembersSheetOpen: (v) => set({ membersSheetOpen: v }),
  setSearchOpen: (v) => set({ searchOpen: v }),
  setThreadsOpen: (v) => set({ threadsOpen: v }),
  setActiveChannelId: (id) => set({ activeChannelId: id }),
  setProfileEditMode: (v) => set({ profileEditMode: v }),
  setTheaterPrompt: (prompt) => set({ theaterPrompt: prompt }),
  openMediaViewer: (url, name = null, items, index = 0) => {
    const gallery = Array.isArray(items) && items.length > 0
      ? items
      : [{ url, name }];
    const safeIndex = Math.max(0, Math.min(index, gallery.length - 1));
    const active = gallery[safeIndex] ?? { url, name };
    set({
      mediaViewerOpen: true,
      mediaViewerUrl: active.url,
      mediaViewerName: active.name ?? null,
      mediaViewerItems: gallery,
      mediaViewerIndex: safeIndex,
    });
  },
  setMediaViewerIndex: (index) => set((s) => {
    const safeIndex = Math.max(0, Math.min(index, s.mediaViewerItems.length - 1));
    const active = s.mediaViewerItems[safeIndex] ?? null;
    if (!active) return s;
    return {
      mediaViewerIndex: safeIndex,
      mediaViewerUrl: active.url,
      mediaViewerName: active.name ?? null,
    };
  }),
  closeMediaViewer: () => set({
    mediaViewerOpen: false,
    mediaViewerUrl: null,
    mediaViewerName: null,
    mediaViewerItems: [],
    mediaViewerIndex: 0,
  }),
  closeAll: () =>
    set((s) => ({
      ...requestDrawer(s, null),
      serverDrawerOpen: false,
      channelsSheetOpen: false,
      membersSheetOpen: false,
      searchOpen: false,
      threadsOpen: false,
      mediaViewerOpen: false,
      mediaViewerUrl: null,
      mediaViewerName: null,
      mediaViewerItems: [],
      mediaViewerIndex: 0,
      profileEditMode: false,
    })),
}));
