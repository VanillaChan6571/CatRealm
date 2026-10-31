import { useEffect, useMemo, useState } from 'react';
import { DevicePhoneMobileIcon } from '@heroicons/react/24/solid';
import { getRoleNameStyle, getRolePrimaryColor } from '../../lib/roleStyles';
import { usePresenceStore } from '../../stores/presenceStore';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { useChannelStore } from '../../stores/channelStore';
import { AvatarImage } from '../ui/AvatarImage';
import { useUIStore } from '../../stores/uiStore';
import { writeClipboardText } from '../../lib/clipboard';
import { createApi } from '../../lib/api';
import { resolveAvatarUrl, resolveRoleIconUrl } from '../../utils/avatar';
import { resolveDisplayName } from '../../utils/displayName';
import { ActivityDisplay } from '../ui/ActivityDisplay';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { BotBadge } from '../ui/BotBadge';
import { hasPermission, PERMISSIONS } from '../../utils/permissions';
import type { OnlineUser } from '../../types';
import { Crown } from 'lucide-react';

function shouldDebugMemberList(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('catrealm:debug-presence') === '1';
  } catch {
    return false;
  }
}

function logMemberListDebug(serverUrl: string | null, allMembers: OnlineUser[], onlineUsers: OnlineUser[], merged: MemberEntry[]) {
  if (!shouldDebugMemberList()) return;
  const summarize = (users: Array<OnlineUser | MemberEntry>) => users.slice(0, 8).map((user) => ({
    id: user.id,
    username: user.username,
    status: user.status ?? null,
    customStatusText: user.customStatusText ?? null,
    activityType: user.activityType ?? null,
    activityText: user.activityText ?? null,
    offline: 'offline' in user ? user.offline ?? false : undefined,
  }));
  console.debug('[presence-debug] member-list', {
    serverUrl,
    allMembersCount: allMembers.length,
    onlineUsersCount: onlineUsers.length,
    mergedCount: merged.length,
    allMembersWithActivity: allMembers.filter((user) => !!user.activityType && !!user.activityText).length,
    onlineUsersWithActivity: onlineUsers.filter((user) => !!user.activityType && !!user.activityText).length,
    mergedWithActivity: merged.filter((user) => !!user.activityType && !!user.activityText).length,
    allMembersSample: summarize(allMembers),
    onlineUsersSample: summarize(onlineUsers),
    mergedSample: summarize(merged),
  });
}

interface MemberEntry extends OnlineUser {
  offline?: boolean;
}

export function mergeMemberPresence(base: OnlineUser | undefined, live: OnlineUser): MemberEntry {
  const hasCustomStatusText = Object.prototype.hasOwnProperty.call(live, 'customStatusText');
  const hasActivityType = Object.prototype.hasOwnProperty.call(live, 'activityType');
  const hasActivityText = Object.prototype.hasOwnProperty.call(live, 'activityText');
  const hasActivityStartedAt = Object.prototype.hasOwnProperty.call(live, 'activityStartedAt');
  const merged = {
    ...(base ?? {}),
    ...live,
    customStatusText: hasCustomStatusText ? (live.customStatusText ?? null) : (base?.customStatusText ?? null),
    activityType: hasActivityType ? (live.activityType ?? null) : (base?.activityType ?? null),
    activityText: hasActivityText ? (live.activityText ?? null) : (base?.activityText ?? null),
    activityStartedAt: hasActivityStartedAt ? (live.activityStartedAt ?? null) : (base?.activityStartedAt ?? null),
  } as MemberEntry;

  const isInvisible = isOfflineLikeStatus(merged.status);
  return {
    ...merged,
    offline: isInvisible,
    status: isInvisible ? 'invisible' : merged.status,
  };
}

function getActivity(user: MemberEntry): { customStatusText: string | null; type: string | null; text: string | null; startedAt: number | null } {
  const withSnake = user as MemberEntry & {
    custom_status_text?: string | null;
    activity_type?: string | null;
    activity_text?: string | null;
    activity_started_at?: number | null;
  };
  return {
    customStatusText: user.customStatusText ?? withSnake.custom_status_text ?? null,
    type: user.activityType ?? withSnake.activity_type ?? null,
    text: user.activityText ?? withSnake.activity_text ?? null,
    startedAt: user.activityStartedAt ?? withSnake.activity_started_at ?? null,
  };
}

function isOfflineLikeStatus(status: unknown): boolean {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return normalized === 'invisible' || normalized === 'offline';
}

export function buildMemberList(allMembers: OnlineUser[], onlineUsers: OnlineUser[]): MemberEntry[] {
  const seen = new Set<string>();
  const result: MemberEntry[] = [];
  const allMembersById = new Map(allMembers.map((member) => [member.id, member]));

  // Online users first (with live presence data)
  for (const u of onlineUsers) {
    seen.add(u.id);
    result.push(mergeMemberPresence(allMembersById.get(u.id), u));
  }

  // Offline users from allMembers
  for (const u of allMembers) {
    if (!seen.has(u.id)) {
      result.push({ ...u, status: undefined, offline: true });
    }
  }

  return result;
}

export function filterMemberListByVisibleIds(users: MemberEntry[], visibleMemberIds: Set<string> | null): MemberEntry[] {
  if (!visibleMemberIds) return users;
  return users.filter((user) => visibleMemberIds.has(user.id));
}

interface RoleGroup {
  roleName: string;
  roleIcon: string | null;
  rolePosition: number;
  users: MemberEntry[];
}

const MEMBERS_GROUP_KEY = '__members';

function groupByRole(users: MemberEntry[], membersLabel: string): RoleGroup[] {
  // Group users by their role
  const roleMap = new Map<string, RoleGroup>();

  for (const user of users) {
    if (user.roleHoist && user.roleName && user.roleName !== membersLabel) {
      // Hoisted roles get their own section
      const key = user.roleName;
      if (!roleMap.has(key)) {
        roleMap.set(key, {
          roleName: user.roleName,
          roleIcon: user.roleIcon || null,
          rolePosition: user.rolePosition || 0,
          users: [],
        });
      }
      roleMap.get(key)!.users.push(user);
    } else {
      // Non-hoisted users go under the default role's name
      const key = MEMBERS_GROUP_KEY;
      if (!roleMap.has(key)) {
        roleMap.set(key, {
          roleName: membersLabel,
          roleIcon: null,
          rolePosition: -1, // Members always at bottom
          users: [],
        });
      }
      roleMap.get(key)!.users.push(user);
    }
  }

  // Sort groups by position (descending)
  return Array.from(roleMap.values()).sort((a, b) => b.rolePosition - a.rolePosition);
}

export function MemberList() {
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);
  const allMembers = usePresenceStore((s) => s.allMembers);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const authServerUrl = useAuthStore((s) => s.serverUrl);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const serverUrl = activeServerUrl || authServerUrl;
  const openModal = useUIStore((s) => s.openModal);
  const currentUser = useAuthStore((s) => s.user);
  const membersLabel = useAuthStore((s) => s.serverInfo?.defaultRoleName) || 'Members';
  const userPermissions = currentUser?.permissions;
  const [visibleMemberIds, setVisibleMemberIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!activeChannelId) {
      setVisibleMemberIds(null);
      return;
    }

    let cancelled = false;
    createApi()
      .get<OnlineUser[]>('/api/users', { params: { channelId: activeChannelId } })
      .then((res) => {
        if (cancelled) return;
        setVisibleMemberIds(new Set(res.data.map((member) => member.id)));
      })
      .catch(() => {
        if (!cancelled) setVisibleMemberIds(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeChannelId, serverUrl, allMembers.length]);

  const { mergedEntries, onlineEntries, offlineEntries } = useMemo(() => {
    const merged = filterMemberListByVisibleIds(
      buildMemberList(allMembers, onlineUsers),
      visibleMemberIds,
    );
    return {
      mergedEntries: merged,
      onlineEntries: merged.filter((u) => !u.offline),
      offlineEntries: merged.filter((u) => u.offline),
    };
  }, [allMembers, onlineUsers, visibleMemberIds]);

  useEffect(() => {
    logMemberListDebug(serverUrl, allMembers, onlineUsers, mergedEntries);
  }, [serverUrl, allMembers, onlineUsers, mergedEntries]);

  const onlineGroups = useMemo(() => groupByRole(onlineEntries, membersLabel), [onlineEntries, membersLabel]);
  const hasHoistedOnlineGroups = useMemo(
    () => onlineEntries.some((u) => !!u.roleHoist && !!u.roleName),
    [onlineEntries]
  );
  return (
    <div className="w-full md:w-60 bg-bg-sidebar h-full overflow-y-auto overflow-x-hidden shrink-0">
      <div className="px-4 py-3">
        {/* Online section */}
        {onlineGroups.map((group) => (
          <UserGroup
            key={`online-${group.roleName}`}
            label={`${(!hasHoistedOnlineGroups && group.rolePosition === -1) ? 'Online' : group.roleName} — ${group.users.length}`}
            roleIcon={group.roleIcon}
            users={group.users}
            serverUrl={serverUrl}
            openModal={openModal}
            userPermissions={userPermissions}
            currentUserId={currentUser?.id}
          />
        ))}

        {/* Offline section */}
        {offlineEntries.length > 0 && (
          <>
            <div className="mt-4 mb-2 border-t border-border" />
            <UserGroup
              key="offline-all"
              label={`Offline - ${offlineEntries.length}`}
              roleIcon={null}
              users={offlineEntries}
              serverUrl={serverUrl}
              openModal={openModal}
              userPermissions={userPermissions}
              currentUserId={currentUser?.id}
              dimmed
            />
          </>
        )}
      </div>
    </div>
  );
}

function UserGroup({ label, roleIcon, users, serverUrl, openModal, userPermissions, currentUserId, dimmed }: { label: string; roleIcon?: string | null; users: MemberEntry[]; serverUrl: string | null; openModal: (name: string, data?: unknown) => void; userPermissions?: number; currentUserId?: string; dimmed?: boolean }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold uppercase text-text-muted mb-2 flex items-center gap-1.5">
        {roleIcon && resolveRoleIconUrl(roleIcon, serverUrl) && (
          <img src={resolveRoleIconUrl(roleIcon, serverUrl)!} alt="" className="w-4 h-4 rounded" />
        )}
        {label}
      </h3>
      <div className="space-y-0.5">
        {users.map((user) => (
          <div
            key={user.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover/50 transition-colors ${dimmed ? 'opacity-40' : ''}`}
            onClick={() => openModal('profileView', { userId: user.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              document.querySelectorAll('.member-context').forEach((el) => el.remove());
              const menu = document.createElement('div');
              menu.className = 'member-context fixed z-50 bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-44 max-w-[calc(100vw-2rem)]';
              menu.style.left = `${e.clientX}px`;
              menu.style.top = `${e.clientY}px`;

              const mkCopyItem = (labelText: string, value: string) => {
                const btn = document.createElement('button');
                btn.className = 'w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50';
                btn.textContent = labelText;
                btn.onclick = () => {
                  void writeClipboardText(value);
                  if (document.body.contains(menu)) document.body.removeChild(menu);
                };
                return btn;
              };

              const mkActionItem = (labelText: string, danger: boolean, action: () => void) => {
                const btn = document.createElement('button');
                btn.className = `w-full text-left px-3 py-1.5 hover:bg-bg-hover/50 ${danger ? 'text-danger' : 'text-text-secondary'}`;
                btn.textContent = labelText;
                btn.onclick = () => {
                  if (document.body.contains(menu)) document.body.removeChild(menu);
                  action();
                };
                return btn;
              };

              menu.appendChild(mkCopyItem('Copy Username', user.username));
              menu.appendChild(mkCopyItem('Copy ID', user.id));

              const canKick = user.id !== currentUserId && hasPermission(userPermissions, PERMISSIONS.KICK_MEMBER);
              const canBan = user.id !== currentUserId && hasPermission(userPermissions, PERMISSIONS.BAN_MEMBER);

              if (canKick || canBan) {
                const divider = document.createElement('div');
                divider.className = 'my-1 border-t border-border';
                menu.appendChild(divider);
              }
              if (canKick) {
                menu.appendChild(mkActionItem('Kick Member', true, () => openModal('kickMember', { userId: user.id, username: user.username })));
              }
              if (canBan) {
                menu.appendChild(mkActionItem('Ban Member', true, () => openModal('banMember', { userId: user.id, username: user.username })));
              }

              const cleanup = () => {
                if (document.body.contains(menu)) document.body.removeChild(menu);
                window.removeEventListener('click', cleanup);
              };
              window.addEventListener('click', cleanup);
              document.body.appendChild(menu);
            }}
          >
            <div className="relative w-8 h-8 rounded-full avatar-bg-muted flex items-center justify-center text-white text-sm font-semibold shrink-0 overflow-hidden">
              <AvatarImage
                src={resolveAvatarUrl(user.avatar, serverUrl, user.accountType)}
                alt={user.username}
                size={32}
                className={`w-8 h-8 object-cover ${dimmed || user.status === 'invisible' ? 'grayscale' : ''}`}
                fallback={<span>{user.username.charAt(0).toUpperCase()}</span>}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                {/* Desktop presence dot — shown when on desktop or no client info */}
                {(!user.clients || user.clients.includes('desktop') || dimmed) && (
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                      dimmed
                        ? 'bg-text-muted'
                        : user.status === 'away'
                        ? 'bg-warning'
                        : user.status === 'sleeping'
                        ? 'status-sleeping'
                        : user.status === 'invisible'
                        ? 'bg-text-muted'
                        : 'bg-success'
                    }`}
                    title={dimmed ? 'offline' : `${user.status ?? 'online'} (desktop)`}
                  />
                )}
                {/* Mobile presence icon */}
                {!dimmed && user.clients?.includes('mobile') && (
                  <DevicePhoneMobileIcon
                    className={`w-3 h-3 shrink-0 ${
                      user.status === 'away' ? 'text-warning'
                      : user.status === 'sleeping' ? 'text-yellow-400'
                      : user.status === 'invisible' ? 'text-text-muted'
                      : 'text-success'
                    }`}
                    title={`${user.status ?? 'online'} (mobile)`}
                  />
                )}
                {(user.isOwner || user.role === 'owner') && <Crown className="mr-1 shrink-0 inline h-3.5 w-3.5" style={{ color: getRolePrimaryColor(user.roleColor, user.roleStyleType, user.roleStyleColors) }} />}
                <BotBadge isBot={user.isBot || user.accountType === 'bot'} size="sm" className="shrink-0" />
                <span
                  className="text-sm truncate block"
                  style={getRoleNameStyle(user.roleColor, user.roleStyleType, user.roleStyleColors)}
                >
                  {resolveDisplayName(user.id, user.username, user.displayName)}
                  {resolveRoleIconUrl(user.roleIcon, serverUrl) && (
                    <img src={resolveRoleIconUrl(user.roleIcon, serverUrl)!} alt="" className="inline-block w-4 h-4 object-contain align-middle ml-0.5 shrink-0" />
                  )}
                </span>
                {user.accountType === 'central' && <VerifiedBadge verified={user.verified} className="shrink-0" />}
              </div>
              {(() => {
                const activity = getActivity(user);
                if (!dimmed && (activity.customStatusText || (activity.type && activity.text))) {
                  return (
                    <ActivityDisplay
                      customStatusText={activity.customStatusText}
                      activityType={activity.type}
                      activityText={activity.text}
                      activityStartedAt={activity.startedAt}
                    />
                  );
                }
                return null;
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
