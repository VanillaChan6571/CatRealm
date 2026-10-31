import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { useDMStore } from '../../../stores/dmStore';
import { useGroupChatStore } from '../../../stores/groupChatStore';
import { AvatarImage } from '../../ui/AvatarImage';
import { AUTH_BASE } from '../../../lib/authApi';
import { resolveAvatarUrl } from '../../../utils/avatar';
import { groupChatFallbackBackground } from '../../../utils/groupChatAvatar';

export type MobileChatsMode = 'dms' | 'groupChats';

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function statusDotClass(status?: string | null) {
  if (status === 'online') return 'bg-success';
  if (status === 'away') return 'bg-warning';
  if (status === 'sleeping') return 'status-sleeping';
  return null;
}

interface MobileChatsScreenProps {
  mode: MobileChatsMode;
  setMode: (mode: MobileChatsMode) => void;
  onOpenDM: (conversationId: string) => void;
  onOpenGroup: (groupId: string) => void;
  onOpenRequests: () => void;
}

/** Chats tab — DMs + group chats in one inbox with a pill switcher, like the mobile app. */
export function MobileChatsScreen({ mode, setMode, onOpenDM, onOpenGroup, onOpenRequests }: MobileChatsScreenProps) {
  const { t } = useTranslation();
  const conversations = useDMStore((s) => s.conversations);
  const loadConversations = useDMStore((s) => s.loadConversations);
  const groups = useGroupChatStore((s) => s.groups);
  const loadGroups = useGroupChatStore((s) => s.loadGroups);

  useEffect(() => {
    void loadConversations();
    void loadGroups();
  }, [loadConversations, loadGroups]);

  const acceptedConversations = useMemo(
    () => conversations
      .filter((c) => !c.requestState || c.requestState === 'accepted')
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)),
    [conversations]
  );
  const pendingRequests = conversations.filter((c) => c.requestState === 'pending').length;
  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => (b.lastMessageAt || b.updatedAt || 0) - (a.lastMessageAt || a.updatedAt || 0)),
    [groups]
  );

  const pill = (value: MobileChatsMode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`flex-1 py-2 rounded-[14px] text-sm font-semibold transition-colors ${
        mode === value ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-bg-primary">
      <div className="px-4 pt-4 shrink-0">
        <h1 className="text-[26px] font-extrabold tracking-tight text-text-primary">{t('mobile.chats')}</h1>
        <div className="mt-3 flex gap-0.5 p-[3px] rounded-2xl bg-bg-elevated">
          {pill('dms', t('mobile.directMessages'))}
          {pill('groupChats', t('nav.groups'))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {mode === 'dms' ? (
          <>
            <button
              type="button"
              onClick={onOpenRequests}
              className="w-full text-left px-4 py-4 text-sm font-medium text-accent"
            >
              {t('mobile.messageRequests', { count: pendingRequests })}
            </button>
            {acceptedConversations.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-text-muted">{t('mobile.noDirectChats')}</p>
            ) : (
              acceptedConversations.map((conversation) => {
                const displayName = conversation.otherDisplayName || conversation.otherUsername;
                const dot = statusDotClass(conversation.otherStatus);
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => onOpenDM(conversation.id)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-bg-hover/50 transition-colors border-b border-border/40"
                  >
                    <div className="relative shrink-0">
                      <AvatarImage
                        src={resolveAvatarUrl(conversation.otherAvatar ?? undefined, AUTH_BASE, 'central')}
                        alt={displayName}
                        size={48}
                        className="w-12 h-12 rounded-full object-cover"
                        fallback={<span className="text-base font-semibold">{displayName.charAt(0).toUpperCase()}</span>}
                      />
                      {dot && (
                        <span className="absolute bottom-0 right-0 flex rounded-full border-2 border-bg-primary">
                          <span className={`block w-2.5 h-2.5 rounded-full ${dot}`} />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-text-primary">{displayName}</div>
                      <div className="truncate text-sm text-text-muted">
                        {conversation.lastMessageAt
                          ? t('mobile.ago', { time: timeAgo(conversation.lastMessageAt) })
                          : t('mobile.noMessages')}
                      </div>
                    </div>
                    {conversation.unreadCount > 0 && (
                      <span className="shrink-0 min-w-[22px] h-[22px] px-[7px] rounded-full bg-accent text-white text-xs font-semibold flex items-center justify-center">
                        {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </>
        ) : sortedGroups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('mobile.noGroupChats')}</p>
        ) : (
          <div className="pt-2">
            {sortedGroups.map((group) => {
              const avatarUrl = resolveAvatarUrl(group.avatar ?? undefined, AUTH_BASE, 'central');
              const lastAt = group.lastMessageAt || 0;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => onOpenGroup(group.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-bg-hover/50 transition-colors border-b border-border/40"
                >
                  <AvatarImage
                    src={avatarUrl}
                    alt={group.name}
                    size={48}
                    className="w-12 h-12 rounded-full object-cover shrink-0"
                    fallback={(
                      <span
                        className="flex h-12 w-12 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: groupChatFallbackBackground(group.id || group.name || 'group-chat') }}
                      >
                        <Users className="w-5 h-5" />
                      </span>
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-text-primary">{group.name}</div>
                    <div className="truncate text-sm text-text-muted">
                      {t('mobile.memberCount', { count: group.memberCount })}
                      {lastAt ? ` · ${t('mobile.ago', { time: timeAgo(lastAt) })}` : ''}
                    </div>
                  </div>
                  {group.unreadCount > 0 && (
                    <span className="shrink-0 min-w-[22px] h-[22px] px-[7px] rounded-full bg-accent text-white text-xs font-semibold flex items-center justify-center">
                      {group.unreadCount > 99 ? '99+' : group.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
