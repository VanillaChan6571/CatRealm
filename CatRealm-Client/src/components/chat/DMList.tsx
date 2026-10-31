import { useEffect } from 'react';
import { useDMStore } from '../../stores/dmStore';
import { useFriendStore } from '../../stores/friendStore';
import { AUTH_BASE } from '../../lib/authApi';
import { defaultAvatarUrl, resolveAvatarUrl } from '../../utils/avatar';
import type { DMConversation, Friend } from '../../types';
import { DevicePhoneMobileIcon } from '@heroicons/react/24/solid';

const getStatusDotClass = (status?: 'online' | 'away' | 'sleeping' | 'invisible') => {
  if (!status || status === 'invisible') return 'bg-text-muted';
  if (status === 'away') return 'bg-yellow-500';
  if (status === 'sleeping') return 'bg-indigo-400';
  return 'bg-green-500';
};

export function DMList() {
  const { conversations, openConversation, loadConversations } = useDMStore();
  const friends = useFriendStore((s) => s.friends);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Get friends without conversations
  const friendsWithoutConversations = friends.filter(
    (friend) => !conversations.some((conv) => conv.otherUserId === friend.id)
  );

  const handleOpenConversation = (friend: Friend | DMConversation) => {
    if ('otherUserId' in friend) {
      // It's a conversation
      openConversation(friend.otherUserId, friend.otherUsername, friend.otherAvatar);
    } else {
      // It's a friend
      openConversation(friend.id, friend.username, friend.avatar);
    }
  };

  const formatLastMessageTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const activeConversationId = useDMStore((s) => s.activeConversationId);

  return (
    <div className={`w-full md:w-80 border-r border-border flex flex-col h-full bg-bg-sidebar ${activeConversationId ? 'hidden md:flex' : 'flex'}`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <h1 className="text-2xl font-bold text-text-primary">Direct Messages</h1>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && friendsWithoutConversations.length === 0 && (
          <div className="p-4 text-center text-text-muted">
            <p>No conversations yet.</p>
            <p className="text-sm mt-1">Add friends to start messaging!</p>
          </div>
        )}

        {/* Active Conversations */}
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => handleOpenConversation(conv)}
            className="w-full px-5 py-4 hover:bg-bg-hover transition-colors flex items-center gap-4 text-left border-b border-border/50"
          >
            <div className="relative">
              <img
                src={resolveAvatarUrl(conv.otherAvatar ?? undefined, AUTH_BASE, 'central') ?? defaultAvatarUrl()}
                alt={conv.otherUsername}
                className="w-14 h-14 rounded-full"
              />
              <span
                className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-bg-sidebar ${getStatusDotClass(conv.otherStatus)}`}
                title={conv.otherStatus === 'invisible' || !conv.otherStatus ? 'Offline' : conv.otherStatus}
              />
              {conv.otherClients?.includes('mobile') && (
                <DevicePhoneMobileIcon
                  className={`absolute bottom-0 left-0 w-4 h-4 ${
                    conv.otherStatus === 'away' ? 'text-warning'
                    : conv.otherStatus === 'sleeping' ? 'text-yellow-400'
                    : conv.otherStatus === 'invisible' ? 'text-text-muted'
                    : 'text-success'
                  }`}
                  title={`${conv.otherStatus ?? 'online'} (mobile)`}
                />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex flex-col min-w-0 flex-1">
                  <h3 className="font-semibold text-text-primary text-base truncate">
                    {conv.otherDisplayName || conv.otherUsername}
                  </h3>
                  {conv.otherDisplayName && (
                    <span className="text-xs text-text-muted">@{conv.otherUsername}</span>
                  )}
                </div>
                {conv.lastMessageAt && (
                  <span className="text-sm text-text-muted ml-2 flex-shrink-0">
                    {formatLastMessageTime(conv.lastMessageAt)}
                  </span>
                )}
              </div>
              {conv.unreadCount > 0 && (
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="bg-accent text-white text-sm font-bold px-2.5 py-0.5 rounded-full">
                    {conv.unreadCount}
                  </span>
                  <span className="text-sm text-text-muted">new message{conv.unreadCount > 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          </button>
        ))}

        {/* Friends without conversations */}
        {friendsWithoutConversations.length > 0 && (
          <>
            <div className="px-5 py-3 text-sm font-semibold text-text-muted uppercase tracking-wider bg-bg-elevated sticky top-0">
              Friends
            </div>
            {friendsWithoutConversations.map((friend) => (
              <button
                key={friend.id}
                onClick={() => handleOpenConversation(friend)}
                className="w-full px-5 py-4 hover:bg-bg-hover transition-colors flex items-center gap-4 text-left border-b border-border/50"
              >
                <div className="relative">
                  <img
                    src={resolveAvatarUrl(friend.avatar ?? undefined, AUTH_BASE, 'central') ?? defaultAvatarUrl()}
                    alt={friend.username}
                    className="w-14 h-14 rounded-full"
                  />
                  <span
                    className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-bg-sidebar ${getStatusDotClass(friend.status)}`}
                    title={friend.status === 'invisible' || !friend.status ? 'Offline' : friend.status}
                  />
                  {friend.clients?.includes('mobile') && (
                    <DevicePhoneMobileIcon
                      className={`absolute bottom-0 left-0 w-4 h-4 ${
                        friend.status === 'away' ? 'text-warning'
                        : friend.status === 'sleeping' ? 'text-yellow-400'
                        : friend.status === 'invisible' ? 'text-text-muted'
                        : 'text-success'
                      }`}
                      title={`${friend.status ?? 'online'} (mobile)`}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-text-primary text-base truncate">{friend.username}</h3>
                  <p className="text-sm text-text-muted">Click to start conversation</p>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
