import { useEffect } from 'react';
import { useChannelStore } from '../../stores/channelStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { nowPlayingActivityText, useNowPlayingStore } from '../../stores/nowPlayingStore';
import { MemberList } from './MemberList';
import { ChatArea } from '../chat/ChatArea';
import { BotDmsView } from '../bots/BotDmsView';
import { useBotStore } from '../../stores/botStore';
import { ClaimAdminBanner } from '../admin/ClaimAdminBanner';
import { ThreadPanel } from '../chat/ThreadPanel';
import { createApi } from '../../lib/api';
import {
  readCentralPresenceCache,
  writeCentralPresenceCache,
} from '../../lib/centralPresenceCache';
import { logGameActivityDebug } from '../../lib/gameActivityDebug';

const lastSyncedCentralStatusByServer = new Map<string, string>();
const lastSyncedCentralActivityByServer = new Map<string, string>();

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

interface ServerViewProps {
  /** Small-screen layout: the member list slides over the chat instead of taking a column. */
  mobile?: boolean;
}

export function ServerView({ mobile = false }: ServerViewProps) {
  const refreshChannelsIfStale = useChannelStore((s) => s.refreshChannelsIfStale);
  const refreshCategoriesIfStale = useChannelStore((s) => s.refreshCategoriesIfStale);
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const updateUser = useAuthStore((s) => s.updateUser);
  const updateOnlineUser = usePresenceStore((s) => s.updateOnlineUser);
  const ownNowPlaying = useNowPlayingStore((s) => (user?.id ? s.byUserId[user.id] ?? null : null));
  const memberListOpen = useUIStore((s) => s.memberListOpen);
  const botDmsOpen = useBotStore((s) => s.botDmsOpen);

  useEffect(() => {
    void refreshChannelsIfStale();
    void refreshCategoriesIfStale();
    const intervalId = window.setInterval(() => {
      void refreshChannelsIfStale();
      void refreshCategoriesIfStale();
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, [refreshChannelsIfStale, refreshCategoriesIfStale]);

  useEffect(() => {
    if (!user || user.accountType !== 'central') return;
    if (!user.id) return;
    writeCentralPresenceCache(user.id, {
      status: user.status ?? undefined,
      customStatusText: user.customStatusText ?? undefined,
      activityType: user.activityType ?? undefined,
      activityText: user.activityText ?? undefined,
      activityStartedAt: user.activityStartedAt ?? undefined,
    });
  }, [user?.id, user?.accountType, user?.status, user?.customStatusText, user?.activityType, user?.activityText, user?.activityStartedAt]);

  // Fetch profile for local accounts
  useEffect(() => {
    if (!serverUrl || !user || user.accountType !== 'local') return;
    const api = createApi();
    api.get('/api/profile/me')
      .then((res) => {
        const activityType = res.data.activityType ?? res.data.activity_type ?? null;
        const activityText = res.data.activityText ?? res.data.activity_text ?? null;
        const activityStartedAt = res.data.activityStartedAt ?? res.data.activity_started_at ?? null;
        updateUser({
          avatar: res.data.avatar ?? null,
          bio: res.data.bio ?? null,
          status: res.data.status ?? 'online',
          customStatusText: res.data.customStatusText ?? res.data.custom_status_text ?? null,
          activityType,
          activityText,
          activityStartedAt,
        });
        updateOnlineUser(res.data.id, {
          avatar: res.data.avatar ?? null,
          status: res.data.status ?? 'online',
          customStatusText: res.data.customStatusText ?? res.data.custom_status_text ?? null,
          activityType,
          activityText,
          activityStartedAt,
        });
      })
      .catch(() => {});
  }, [serverUrl, user?.id, user?.accountType, updateUser, updateOnlineUser]);

  useEffect(() => {
    if (!serverUrl || !user || user.accountType !== 'central') return;
    const cachedPresence = readCentralPresenceCache(user.id);
    const customStatusText = user.customStatusText ?? cachedPresence?.customStatusText ?? null;
    const api = createApi();
    if (!customStatusText) {
      api.delete('/api/profile/me/custom-status')
        .then((res) => {
          writeCentralPresenceCache(user.id, { customStatusText: null });
          updateOnlineUser(res.data.id, { customStatusText: null });
        })
        .catch(() => {});
      return;
    }
    api.put('/api/profile/me/custom-status', { customStatusText })
      .then((res) => {
        const nextCustomStatusText = res.data.customStatusText ?? res.data.custom_status_text ?? customStatusText;
        writeCentralPresenceCache(user.id, { customStatusText: nextCustomStatusText });
        updateOnlineUser(res.data.id, { customStatusText: nextCustomStatusText });
      })
      .catch(() => {});
  }, [serverUrl, user?.id, user?.accountType, user?.customStatusText, updateOnlineUser]);

  // Sync central status to server
  useEffect(() => {
    if (!serverUrl || !user || user.accountType !== 'central') return;
    const cachedPresence = readCentralPresenceCache(user.id);
    const status = user.status ?? cachedPresence?.status ?? 'online';
    const syncKey = `${serverUrl}::${user.id}`;
    if (lastSyncedCentralStatusByServer.get(syncKey) === status) return;
    const api = createApi();
    api.put('/api/profile/me/status', { status })
      .then((res) => {
        const nextStatus = res.data.status ?? status;
        lastSyncedCentralStatusByServer.set(syncKey, nextStatus);
        writeCentralPresenceCache(user.id, { status: nextStatus });
        updateOnlineUser(res.data.id, { status: nextStatus });
      })
      .catch(() => {});
  }, [serverUrl, user?.id, user?.accountType, user?.status, updateOnlineUser]);

  // Sync central activity to server
  useEffect(() => {
    if (!serverUrl || !user || user.accountType !== 'central') return;
    const cachedPresence = readCentralPresenceCache(user.id);
    const ownActivityType = hasOwn(user, 'activityType')
      ? (user.activityType ?? null)
      : (cachedPresence?.activityType ?? null);
    const ownActivityText = hasOwn(user, 'activityText')
      ? (user.activityText ?? null)
      : (cachedPresence?.activityText ?? null);
    const ownActivityStartedAt = hasOwn(user, 'activityStartedAt')
      ? (user.activityStartedAt ?? null)
      : (cachedPresence?.activityStartedAt ?? null);
    // A manual or game activity wins; otherwise mirror the Last.fm track so
    // realm member lists show it.
    const useLastfm = !(ownActivityType && ownActivityText) && !!ownNowPlaying;
    const activityType = useLastfm ? 'Listening' : ownActivityType;
    const activityText = useLastfm && ownNowPlaying ? nowPlayingActivityText(ownNowPlaying) : ownActivityText;
    const activityStartedAt = useLastfm ? (ownNowPlaying?.startedAt ?? null) : ownActivityStartedAt;
    const syncKey = `${serverUrl}::${user.id}`;
    const nextSignature = `${activityType || ''}::${activityText || ''}::${activityStartedAt || ''}`;
    logGameActivityDebug('server-sync:activity:check', {
      userId: user.id,
      serverUrl,
      userActivityType: user.activityType ?? null,
      userActivityText: user.activityText ?? null,
      userActivityStartedAt: user.activityStartedAt ?? null,
      cachedPresence,
      hasOwnActivityType: hasOwn(user, 'activityType'),
      hasOwnActivityText: hasOwn(user, 'activityText'),
      hasOwnActivityStartedAt: hasOwn(user, 'activityStartedAt'),
      chosenActivityType: activityType,
      chosenActivityText: activityText,
      chosenActivityStartedAt: activityStartedAt,
      nextSignature,
      lastSignature: lastSyncedCentralActivityByServer.get(syncKey) ?? null,
    });
    if (lastSyncedCentralActivityByServer.get(syncKey) === nextSignature) return;
    const api = createApi();
    if (!activityType || !activityText) {
      api.delete('/api/profile/me/activity')
        .then((res) => {
          logGameActivityDebug('server-sync:activity:delete:success', {
            userId: user.id,
            serverUrl,
            responseActivityType: res.data.activityType ?? res.data.activity_type ?? null,
            responseActivityText: res.data.activityText ?? res.data.activity_text ?? null,
            responseActivityStartedAt: res.data.activityStartedAt ?? res.data.activity_started_at ?? null,
          });
          lastSyncedCentralActivityByServer.set(syncKey, nextSignature);
          writeCentralPresenceCache(user.id, {
            activityType: null,
            activityText: null,
            activityStartedAt: null,
          });
          updateOnlineUser(res.data.id, {
            activityType: null,
            activityText: null,
            activityStartedAt: null,
          });
        })
        .catch((error) => {
          logGameActivityDebug('server-sync:activity:delete:error', {
            userId: user.id,
            serverUrl,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }
    api.put('/api/profile/me/activity', { activityType, activityText, activityStartedAt })
      .then((res) => {
        const nextActivityType = res.data.activityType ?? activityType;
        const nextActivityText = res.data.activityText ?? activityText;
        const nextActivityStartedAt = res.data.activityStartedAt ?? res.data.activity_started_at ?? activityStartedAt;
        logGameActivityDebug('server-sync:activity:put:success', {
          userId: user.id,
          serverUrl,
          nextActivityType,
          nextActivityText,
          nextActivityStartedAt,
        });
        lastSyncedCentralActivityByServer.set(syncKey, `${nextActivityType}::${nextActivityText}::${nextActivityStartedAt || ''}`);
        // The Last.fm mirror is realm-only; caching it as the Central activity
        // would resurrect it after playback stops.
        if (!useLastfm) {
          writeCentralPresenceCache(user.id, {
            activityType: nextActivityType,
            activityText: nextActivityText,
            activityStartedAt: nextActivityStartedAt,
          });
        }
        updateOnlineUser(res.data.id, {
          activityType: nextActivityType,
          activityText: nextActivityText,
          activityStartedAt: nextActivityStartedAt,
        });
      })
      .catch((error) => {
        logGameActivityDebug('server-sync:activity:put:error', {
          userId: user.id,
          serverUrl,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [serverUrl, user?.id, user?.accountType, user?.activityType, user?.activityText, user?.activityStartedAt, ownNowPlaying, updateOnlineUser]);

  // Idle detection for local accounts
  useEffect(() => {
    if (!serverUrl || !user || user.accountType !== 'local') return;
    const api = createApi();
    let lastActivity = Date.now();
    let idle = false;
    let nextWakeAttemptAt = 0;
    const idleMs = 30 * 60 * 1000;

    const markActive = () => {
      lastActivity = Date.now();
      if ((user.status === 'sleeping' || idle) && Date.now() >= nextWakeAttemptAt) {
        idle = false;
        nextWakeAttemptAt = Date.now() + 30 * 1000;
        api.put('/api/profile/me/status', { status: 'online' })
          .then((res) => {
            updateUser({ status: res.data.status });
            updateOnlineUser(res.data.id, { status: res.data.status });
          })
          .catch(() => {});
      }
    };

    const interval = setInterval(() => {
      if (idle) return;
      if (user.status && user.status !== 'online') return;
      if (Date.now() - lastActivity >= idleMs) {
        idle = true;
        api.put('/api/profile/me/status', { status: 'sleeping' })
          .then((res) => {
            updateUser({ status: res.data.status });
            updateOnlineUser(res.data.id, { status: res.data.status });
          })
          .catch(() => {});
      }
    }, 30 * 1000);

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));
    return () => {
      clearInterval(interval);
      events.forEach((evt) => window.removeEventListener(evt, markActive));
    };
  }, [serverUrl, user?.id, user?.accountType, user?.status, updateUser, updateOnlineUser]);

  return (
    <>
      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ClaimAdminBanner />
        {botDmsOpen ? <BotDmsView /> : <ChatArea />}
      </div>

      {/* Thread panel */}
      <ThreadPanel />

      {/* Member list */}
      {mobile && memberListOpen && (
        <div className="fixed inset-0 bg-black/50 z-20" onClick={() => useUIStore.getState().toggleMemberList()} />
      )}
      <div className={mobile ? 'fixed inset-y-0 right-0 z-30' : 'shrink-0'}>
        <div
          className={`h-full transition-all duration-300 ease-out overflow-hidden ${memberListOpen ? `${mobile ? 'w-[85vw] max-w-xs' : 'w-64'} opacity-100 translate-x-0` : 'w-0 opacity-0 translate-x-full pointer-events-none'}`}
        >
          <MemberList />
        </div>
      </div>
    </>
  );
}
