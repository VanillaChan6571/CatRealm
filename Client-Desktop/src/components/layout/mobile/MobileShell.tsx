import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Menu, Users, X } from 'lucide-react';
import { useServerStore } from '../../../stores/serverStore';
import { useUIStore } from '../../../stores/uiStore';
import { useDMStore } from '../../../stores/dmStore';
import { useGroupChatStore } from '../../../stores/groupChatStore';
import { useFriendStore } from '../../../stores/friendStore';
import { useNotificationStore } from '../../../messaging/notifications/notificationStore';
import { Sidebar } from '../Sidebar';
import { ServerView } from '../ServerView';
import { VoiceStatusPanel } from '../VoiceStatusPanel';
import { HomeView } from '../../home/HomeView';
import type { Tab } from '../../home/HomeNav';
import { CallingIndicator } from '../../calls/CallingIndicator';
import { IncomingCallModal } from '../../calls/IncomingCallModal';
import { CallDeclinedToast } from '../../calls/CallDeclinedToast';
import { MobileDock, MOBILE_DOCK_HEIGHT, type MobileDockId } from './MobileDock';
import { MobileServerList } from './MobileServerList';
import { MobileChatsScreen } from './MobileChatsScreen';
import { MobileMeScreen } from './MobileMeScreen';

const CHAT_TABS: ReadonlySet<Tab> = new Set<Tab>(['dms', 'groupChats', 'messageRequests']);
const HOME_PILLS: Tab[] = ['friends', 'pending', 'add', 'notes'];
const DOUBLE_TAP_MS = 350;

interface MobileShellProps {
  homeTab: Tab;
  setHomeTab: (tab: Tab) => void;
  roleViewBanner: ReactNode;
}

/**
 * Small-screen layout for central accounts, mirroring the mobile app: a
 * five-up bottom dock (Home, Servers, Chats, Notifications, You), list-first
 * chats, and a slide-in server drawer.
 *
 * `uiStore.mobileNavOpen` means "showing the chats list" — an open DM or
 * group chat sets it false, and the DM header's back button sets it true.
 */
export function MobileShell({ homeTab, setHomeTab, roleViewBanner }: MobileShellProps) {
  const { t } = useTranslation();
  const servers = useServerStore((s) => s.servers);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const switchServer = useServerStore((s) => s.switchServer);
  const goHome = useServerStore((s) => s.goHome);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleMemberList = useUIStore((s) => s.toggleMemberList);
  const showingChatList = useUIStore((s) => s.mobileNavOpen);
  const setShowingChatList = useUIStore((s) => s.setMobileNavOpen);
  const conversations = useDMStore((s) => s.conversations);
  const activeConversationId = useDMStore((s) => s.activeConversationId);
  const openConversation = useDMStore((s) => s.openConversation);
  const groups = useGroupChatStore((s) => s.groups);
  const activeGroupId = useGroupChatStore((s) => s.activeGroupId);
  const selectGroup = useGroupChatStore((s) => s.selectGroup);
  const incomingFriendRequests = useFriendStore((s) => s.incoming.length);
  const notificationUnread = useNotificationStore((s) => s.summary?.totalUnread ?? 0);

  // Screens the dock can show that aren't expressed by server/home-tab state.
  const [surface, setSurface] = useState<'me' | 'serverList' | null>(null);
  const [serverDrawerOpen, setServerDrawerOpen] = useState(false);
  const [lastServerUrl, setLastServerUrl] = useState<string | null>(activeServerUrl);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const lastServersTap = useRef(0);

  // Entering a server, or anything that changes the home tab (notification
  // clicks, call returns), takes the user off the You / server-list screens.
  const [seenServerUrl, setSeenServerUrl] = useState(activeServerUrl);
  const [seenHomeTab, setSeenHomeTab] = useState(homeTab);
  if (activeServerUrl !== seenServerUrl) {
    setSeenServerUrl(activeServerUrl);
    if (activeServerUrl) {
      setLastServerUrl(activeServerUrl);
      setSurface(null);
    }
  }
  if (homeTab !== seenHomeTab) {
    setSeenHomeTab(homeTab);
    setSurface(null);
  }

  // A conversation opened from anywhere (list tap, notification, call
  // return, profile "Message") leaves the chats list for the conversation.
  const seenConversationId = useRef(activeConversationId);
  useEffect(() => {
    if (activeConversationId && activeConversationId !== seenConversationId.current) {
      setShowingChatList(false);
      setSurface(null);
    }
    seenConversationId.current = activeConversationId;
  }, [activeConversationId, setShowingChatList]);
  const seenGroupId = useRef(activeGroupId);
  useEffect(() => {
    if (activeGroupId && activeGroupId !== seenGroupId.current) {
      setShowingChatList(false);
      setSurface(null);
    }
    seenGroupId.current = activeGroupId;
  }, [activeGroupId, setShowingChatList]);

  // `data-mobile-layout` switches off Tailwind's md/lg/xl variants (see
  // index.css) so screens inside render their phone versions at any window
  // width. Side panels start closed; the desktop layout expects them open.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-mobile-layout', '');
    useUIStore.setState({ sidebarOpen: false, memberListOpen: false });
    return () => {
      root.removeAttribute('data-mobile-layout');
      useUIStore.setState({ sidebarOpen: true, memberListOpen: true });
    };
  }, []);

  // Hide the dock while the on-screen keyboard is up, like the app does.
  useEffect(() => {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    const isTextField = (el: EventTarget | null) => el instanceof HTMLElement
      && (el.tagName === 'TEXTAREA'
        || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes((el as HTMLInputElement).type))
        || el.isContentEditable);
    const onFocusIn = (event: FocusEvent) => setKeyboardOpen(isTextField(event.target));
    const onFocusOut = () => setKeyboardOpen(false);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // Fixed floating bars (voice, call, rejoin) read this to clear the dock.
  const dockVisible = !keyboardOpen && !(surface === 'me' && profileEditing);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      '--mobile-dock-offset',
      dockVisible ? `calc(${MOBILE_DOCK_HEIGHT}px + env(safe-area-inset-bottom, 0px))` : '0px',
    );
    return () => { root.style.removeProperty('--mobile-dock-offset'); };
  }, [dockVisible]);

  const activeDock: MobileDockId = surface === 'me'
    ? 'me'
    : surface === 'serverList' || activeServerUrl || homeTab === 'discover'
    ? 'servers'
    : CHAT_TABS.has(homeTab)
    ? 'chats'
    : homeTab === 'notifications'
    ? 'notifications'
    : 'home';

  const openHomeTab = (tab: Tab) => {
    setSurface(null);
    setServerDrawerOpen(false);
    if (activeServerUrl) goHome();
    setHomeTab(tab);
  };

  const openServer = (url: string) => {
    setServerDrawerOpen(false);
    setSurface(null);
    setLastServerUrl(url);
    if (url !== activeServerUrl) switchServer(url);
  };

  const handleServersPress = () => {
    const now = Date.now();
    const isDoubleTap = now - lastServersTap.current < DOUBLE_TAP_MS;
    lastServersTap.current = isDoubleTap ? 0 : now;
    if (isDoubleTap) {
      setServerDrawerOpen((open) => !open);
      return;
    }
    if (activeServerUrl && surface === null) {
      // Already in a server: a second tap toggles the drawer, like the app.
      setServerDrawerOpen((open) => !open);
      return;
    }
    const resumeUrl = activeServerUrl ?? lastServerUrl;
    if (resumeUrl && servers.some((server) => server.url === resumeUrl)) {
      openServer(resumeUrl);
      return;
    }
    setSurface('serverList');
  };

  const handleDockPress = (id: MobileDockId) => {
    switch (id) {
      case 'home':
        openHomeTab(HOME_PILLS.includes(homeTab) ? homeTab : 'friends');
        break;
      case 'servers':
        handleServersPress();
        break;
      case 'chats':
        setShowingChatList(true);
        openHomeTab(homeTab === 'groupChats' ? 'groupChats' : 'dms');
        break;
      case 'notifications':
        openHomeTab('notifications');
        break;
      case 'me':
        setServerDrawerOpen(false);
        setSurface('me');
        break;
    }
  };

  const totalDmUnread = conversations
    .filter((c) => !c.requestState || c.requestState === 'accepted')
    .reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const totalGroupUnread = groups.reduce((sum, group) => sum + (group.unreadCount || 0), 0);

  const pageTitle = (title: string) => (
    <div className="px-4 pt-4 pb-2 shrink-0">
      <h1 className="text-[26px] font-extrabold tracking-tight text-text-primary">{title}</h1>
    </div>
  );

  const backBar = (title: string, onBack: () => void) => (
    <div className="h-12 flex items-center gap-2 px-2 border-b border-border bg-bg-sidebar shrink-0">
      <button
        type="button"
        onClick={onBack}
        className="p-2 text-text-secondary hover:text-text-primary"
        aria-label={t('common.back')}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <span className="text-[15px] font-semibold text-text-primary truncate">{title}</span>
    </div>
  );

  const renderServerListScreen = () => (
    <div className="flex-1 min-h-0 overflow-y-auto bg-bg-primary">
      <div className="px-4 pt-4 pb-6">
        <h1 className="text-[26px] font-extrabold tracking-tight text-text-primary">{t('nav.servers')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('mobile.serversHint')}</p>
        <div className="mt-5">
          <MobileServerList onOpenServer={openServer} onDiscover={() => openHomeTab('discover')} />
        </div>
      </div>
    </div>
  );

  const renderServer = () => {
    const serverName = servers.find((server) => server.url === activeServerUrl)?.name ?? t('nav.servers');
    return (
      <>
        <div className="h-12 flex items-center gap-1 px-2 bg-bg-sidebar border-b border-border shrink-0">
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-2 text-text-secondary hover:text-text-primary shrink-0"
            aria-label={t('mobile.channels')}
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setServerDrawerOpen(true)}
            className="flex-1 min-w-0 text-left text-[15px] font-semibold text-text-primary truncate"
          >
            {serverName}
          </button>
          <button
            type="button"
            onClick={toggleMemberList}
            className="p-2 text-text-secondary hover:text-text-primary shrink-0"
            aria-label={t('mobile.members')}
          >
            <Users className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-1 min-h-0 relative overflow-hidden flex-col">
          {roleViewBanner}
          <div className="flex flex-1 min-h-0 relative overflow-hidden">
            {sidebarOpen && (
              <div className="fixed inset-0 bg-black/50 z-20" onClick={toggleSidebar} />
            )}
            <div className="fixed inset-y-0 left-0 z-30">
              <div
                className={`h-full transition-all duration-300 ease-out overflow-hidden ${
                  sidebarOpen
                    ? 'w-[85vw] max-w-xs opacity-100 translate-x-0'
                    : 'w-0 opacity-0 -translate-x-full pointer-events-none'
                }`}
              >
                <Sidebar showFooter={false} />
              </div>
            </div>
            <ServerView mobile />
          </div>
        </div>
      </>
    );
  };

  const renderHome = () => {
    const pillLabel = (tab: Tab) => {
      if (tab === 'pending') {
        return incomingFriendRequests > 0 ? `${t('nav.pending')} (${incomingFriendRequests})` : t('nav.pending');
      }
      if (tab === 'add') return t('nav.addFriend');
      if (tab === 'notes') return t('nav.myNotes');
      return t('nav.friends');
    };
    return (
      <>
        {pageTitle(t('nav.home'))}
        <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto shrink-0 [scrollbar-width:none]">
          {HOME_PILLS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setHomeTab(tab)}
              className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                homeTab === tab ? 'bg-accent text-white' : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
              }`}
            >
              {pillLabel(tab)}
            </button>
          ))}
        </div>
        <div className="flex flex-1 min-h-0">
          <HomeView tab={homeTab} setTab={setHomeTab} />
        </div>
      </>
    );
  };

  const renderChats = () => {
    if (homeTab === 'messageRequests') {
      return (
        <>
          {backBar(t('mobile.messageRequestsTitle'), () => setHomeTab('dms'))}
          <div className="flex flex-1 min-h-0">
            <HomeView tab="messageRequests" setTab={setHomeTab} />
          </div>
        </>
      );
    }
    if (showingChatList) {
      return (
        <MobileChatsScreen
          mode={homeTab === 'groupChats' ? 'groupChats' : 'dms'}
          setMode={setHomeTab}
          onOpenRequests={() => setHomeTab('messageRequests')}
          onOpenDM={(conversationId) => {
            const conversation = conversations.find((c) => c.id === conversationId);
            if (!conversation) return;
            setShowingChatList(false);
            void openConversation(conversation.otherUserId, conversation.otherUsername, conversation.otherAvatar);
          }}
          onOpenGroup={(groupId) => {
            setShowingChatList(false);
            setHomeTab('groupChats');
            selectGroup(groupId);
          }}
        />
      );
    }
    return (
      <div className="flex flex-1 min-h-0">
        <HomeView
          tab={homeTab}
          setTab={setHomeTab}
          onMobileBack={() => setShowingChatList(true)}
        />
      </div>
    );
  };

  const renderContent = () => {
    if (surface === 'me') {
      return (
        <MobileMeScreen
          onOpenNotes={() => openHomeTab('notes')}
          onOpenFriends={() => openHomeTab('friends')}
          onEditModeChange={setProfileEditing}
        />
      );
    }
    if (surface === 'serverList') return renderServerListScreen();
    if (activeServerUrl) return renderServer();
    if (CHAT_TABS.has(homeTab)) return renderChats();
    if (homeTab === 'notifications') {
      return (
        <>
          {pageTitle(t('nav.notifications'))}
          <div className="flex flex-1 min-h-0">
            <HomeView tab="notifications" setTab={setHomeTab} />
          </div>
        </>
      );
    }
    if (homeTab === 'discover') {
      return (
        <>
          {backBar(t('nav.discoverServers'), () => setSurface('serverList'))}
          <div className="flex flex-1 min-h-0">
            <HomeView tab="discover" setTab={setHomeTab} />
          </div>
        </>
      );
    }
    return renderHome();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      {/* Incoming / outgoing call cards float over every screen. */}
      <div className="absolute top-2 inset-x-2 z-40 flex flex-col gap-2 pointer-events-none [&>*]:pointer-events-auto [&>*:empty]:hidden">
        <div className="rounded-xl overflow-hidden bg-bg-elevated shadow-lg empty:hidden">
          <IncomingCallModal onNavigateToTab={(tab) => openHomeTab(tab)} />
        </div>
        <div className="rounded-xl overflow-hidden bg-bg-elevated shadow-lg empty:hidden">
          <CallingIndicator />
        </div>
        <CallDeclinedToast />
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        {renderContent()}
      </div>

      <VoiceStatusPanel />
      {dockVisible && (
        <MobileDock
          active={activeDock}
          onPress={handleDockPress}
          badges={{
            home: incomingFriendRequests,
            chats: totalDmUnread + totalGroupUnread,
            notifications: notificationUnread,
          }}
        />
      )}

      {/* Server drawer — slides in from the left over everything but modals. */}
      <div
        className={`fixed inset-0 z-40 bg-black/45 transition-opacity duration-200 ${
          serverDrawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setServerDrawerOpen(false)}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[300px] max-w-[86vw] flex flex-col bg-bg-sidebar border-r border-border shadow-2xl transition-transform duration-200 ease-out ${
          serverDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!serverDrawerOpen}
      >
        <div className="flex items-center gap-2 px-4 pt-5 pb-3 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-text-primary">{t('nav.servers')}</p>
            <p className="text-xs text-text-muted">{t('mobile.selectServer')}</p>
          </div>
          <button
            type="button"
            onClick={() => setServerDrawerOpen(false)}
            className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-hover"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-4">
          <MobileServerList
            onOpenServer={openServer}
            onDiscover={() => { setServerDrawerOpen(false); openHomeTab('discover'); }}
          />
        </div>
      </aside>
    </div>
  );
}
