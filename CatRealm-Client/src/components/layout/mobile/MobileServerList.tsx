import { useTranslation } from 'react-i18next';
import { Compass, SquarePlus } from 'lucide-react';
import { useServerStore, normalizeServerPrefs } from '../../../stores/serverStore';
import { useUIStore } from '../../../stores/uiStore';
import { useNotificationStore } from '../../../messaging/notifications/notificationStore';

function getServerInitial(name: string): string {
  const cleaned = name.replace(/[\p{Emoji}\p{Emoji_Component}\s]/gu, '');
  if (cleaned.length > 0) return cleaned.charAt(0).toUpperCase();
  return Array.from(name)[0] || '?';
}

interface MobileServerListProps {
  /** Called after a server has been switched to. */
  onOpenServer: (url: string) => void;
  /** Called before leaving for Add Server / Discover (e.g. close the drawer). */
  onDiscover: () => void;
}

/**
 * The server list shared by the Servers screen and the server drawer, like
 * the mobile app's ServerListPanel: servers with badges, Add Server, Discover.
 */
export function MobileServerList({ onOpenServer, onDiscover }: MobileServerListProps) {
  const { t } = useTranslation();
  const servers = useServerStore((s) => s.servers);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const switchServer = useServerStore((s) => s.switchServer);
  const snapshots = useServerStore((s) => s.snapshots);
  const serverStatus = useServerStore((s) => s.serverStatus);
  const notificationSummary = useNotificationStore((s) => s.summary);
  const openModal = useUIStore((s) => s.openModal);

  const getCounts = (url: string) => {
    if (url === activeServerUrl) return { mentions: 0, nonMentionUnread: 0 };
    const snap = snapshots[url];
    if (!snap) return { mentions: 0, nonMentionUnread: 0 };
    let unread = 0;
    let mentions = 0;
    for (const [channelId, count] of Object.entries(snap.unreadByChannel)) {
      if (snap.prefsByChannel[channelId]?.muted) continue;
      unread += count ?? 0;
    }
    for (const [channelId, count] of Object.entries(snap.mentionByChannel)) {
      if (snap.prefsByChannel[channelId]?.muted) continue;
      mentions += count ?? 0;
    }
    const canonicalMentions = notificationSummary?.mentionsByRealm[url] ?? mentions;
    return { mentions: canonicalMentions, nonMentionUnread: Math.max(unread - canonicalMentions, 0) };
  };

  return (
    <div className="flex flex-col gap-1.5">
      {servers.length === 0 && (
        <div className="rounded-xl bg-bg-elevated px-4 py-5 text-center text-sm text-text-secondary">
          {t('mobile.noServers')}
        </div>
      )}

      {servers.map((server) => {
        const prefs = normalizeServerPrefs(server.prefs);
        const counts = getCounts(server.url);
        const showMentions = !prefs.muted && counts.mentions > 0;
        const showUnread = !prefs.muted && prefs.badgeMode === 'all' && counts.nonMentionUnread > 0;
        const status = serverStatus[server.url] ?? 'idle';
        const isOffline = status === 'disconnected' || status === 'reconnecting';
        const isActive = server.url === activeServerUrl;
        const resolvedIcon = server.icon
          ?? (server.info.serverIcon
            ? (/^https?:\/\//i.test(server.info.serverIcon)
                ? server.info.serverIcon
                : `${server.url}${server.info.serverIcon}`)
            : null);

        return (
          <button
            key={server.url}
            type="button"
            onClick={() => {
              if (!isActive) switchServer(server.url);
              onOpenServer(server.url);
            }}
            className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition-colors border ${
              isActive
                ? 'bg-accent/15 border-accent/40 text-text-primary'
                : 'bg-bg-elevated border-border/60 text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            <div className="w-11 h-11 rounded-2xl shrink-0 overflow-hidden flex items-center justify-center bg-bg-deepest text-base font-bold text-text-secondary">
              {resolvedIcon ? (
                <img src={resolvedIcon} alt={server.name} className="w-full h-full object-cover" />
              ) : (
                getServerInitial(server.name)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-text-primary">{server.name}</div>
              <div className={`truncate text-xs ${isOffline ? 'text-danger' : 'text-text-muted'}`}>
                {isOffline ? t('mobile.serverOffline') : server.url.replace(/^https?:\/\//, '')}
              </div>
            </div>
            {!isOffline && showMentions && (
              <span className="bg-danger text-white text-[11px] rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center font-semibold shrink-0">
                {counts.mentions > 99 ? '99+' : counts.mentions}
              </span>
            )}
            {!isOffline && !showMentions && showUnread && (
              <span className="bg-white text-black text-[11px] rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center font-semibold shrink-0">
                {counts.nonMentionUnread > 99 ? '99+' : counts.nonMentionUnread}
              </span>
            )}
          </button>
        );
      })}

      <div className="mt-2 pt-2 border-t border-border/60 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => openModal('addServer')}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl bg-bg-elevated border border-border/60 text-success hover:bg-bg-hover transition-colors"
        >
          <SquarePlus className="w-5 h-5 shrink-0" />
          <span className="text-[15px] font-medium">{t('mobile.addServer')}</span>
        </button>
        <button
          type="button"
          onClick={onDiscover}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl bg-bg-elevated border border-border/60 text-accent hover:bg-bg-hover transition-colors"
        >
          <Compass className="w-5 h-5 shrink-0" />
          <span className="text-[15px] font-medium">{t('nav.discoverServers')}</span>
        </button>
      </div>
    </div>
  );
}
