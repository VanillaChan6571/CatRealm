import { useMemo } from 'react';
import { createApi } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { useWorkItemStore, workItemPath, type WorkItem, type WorkKind } from '../../stores/workItemStore';
import { decodeToken } from '../../utils/token';
import { hasPermissionKey } from '../../utils/permissions';
import type { BoardCard, Channel, TrackerIssue, WorkItemUser } from '../../types';

// Hooks and helpers shared by the Tracker and Board channel views.

export const WORK_ITEM_LIMITS = { title: 200, body: 20000, comment: 10000, labelName: 50, listName: 100 } as const;

const PERMISSION_KEYS = {
  tracker: { create: 'CREATE_ISSUES', comment: 'COMMENT_ON_ISSUES', assign: 'ASSIGN_ISSUES', manage: 'MANAGE_ISSUES' },
  board: { create: 'CREATE_CARDS', comment: 'COMMENT_ON_CARDS', assign: 'ASSIGN_CARDS', manage: 'MANAGE_BOARDS' },
} as const;

export interface WorkItemPermissions {
  create: boolean;
  comment: boolean;
  assign: boolean;
  manage: boolean;
  attach: boolean;
}

/** What the current user may do in this channel; mirrors the checks the realm server enforces. */
export function useWorkItemPermissions(kind: WorkKind, channel: Channel): WorkItemPermissions {
  const keys = channel.effective_permission_keys;
  return useMemo(() => {
    const names = PERMISSION_KEYS[kind];
    return {
      create: hasPermissionKey(keys, names.create),
      comment: hasPermissionKey(keys, names.comment),
      assign: hasPermissionKey(keys, names.assign),
      manage: hasPermissionKey(keys, names.manage),
      attach: hasPermissionKey(keys, 'ATTACH_FILES'),
    };
  }, [kind, keys]);
}

/** The signed-in user's id on the active realm (central accounts have a realm-local id). */
export function useSelfUserId(): string | null {
  const user = useAuthStore((s) => s.user);
  const activeServerToken = useServerStore((s) => {
    if (!s.activeServerUrl) return null;
    return s.servers.find((entry) => entry.url === s.activeServerUrl)?.token ?? null;
  });
  return useMemo(() => {
    if (!user) return null;
    if (user.accountType !== 'central') return user.id;
    const payload = activeServerToken ? decodeToken(activeServerToken) : null;
    const tokenId = payload && typeof payload.id === 'string' ? payload.id : null;
    return user.serverUserId ?? tokenId ?? user.id;
  }, [user, activeServerToken]);
}

export function userLabel(user: WorkItemUser | null | undefined) {
  return user ? (user.display_name || user.username) : 'Deleted user';
}

export function relativeTime(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Realm members as work-item users, for assignee and author pickers. */
export function useMemberOptions(): WorkItemUser[] {
  const members = usePresenceStore((s) => s.allMembers);
  return useMemo(() => members
    .filter((member) => !member.isBot && member.accountType !== 'bot')
    .map((member) => ({
      id: member.id,
      username: member.username,
      avatar: member.avatar ?? null,
      account_type: member.accountType ?? 'local',
      display_name: member.displayName ?? null,
    })), [members]);
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
}

export const fieldClass = 'w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none';

export function storeItem(kind: WorkKind, item: WorkItem) {
  const store = useWorkItemStore.getState();
  if (kind === 'tracker') store.applyIssue(item as TrackerIssue);
  else store.applyCard(item as BoardCard);
}

export async function patchItem(kind: WorkKind, item: WorkItem, body: Record<string, unknown>) {
  const res = await createApi().patch<WorkItem>(workItemPath(kind, item.channel_id, item.id), body);
  storeItem(kind, res.data);
  return res.data;
}

/** Realm uploads are stored as paths; turn one into a URL the browser can load. */
export function resolveRealmImage(value: string, serverUrl: string | null): string {
  return /^https?:\/\//i.test(value) ? value : `${(serverUrl ?? '').replace(/\/+$/, '')}${value}`;
}

/** Base URL of the realm being viewed: a local-account session keeps it in the auth store. */
export function useRealmUrl(): string | null {
  const signedInUrl = useAuthStore((s) => s.serverUrl);
  const activeUrl = useServerStore((s) => s.activeServerUrl);
  return signedInUrl || activeUrl;
}
