/**
 * Hooks and helpers shared by the Tracker and Board channel views.
 * Behavior mirrors CatRealm-Client/src/components/workitems/workItemUtils.ts.
 */

import { useMemo } from 'react';
import { createApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useWorkItemStore, workItemPath, type WorkItem, type WorkKind } from '@/stores/workItemStore';
import { hasChannelPermissionKey } from '@/utils/permissions';
import type { BoardCard, Channel, TrackerIssue, TrackerIssuePriority, TrackerIssueState, WorkItemUser } from '@/types';

export const WORK_ITEM_LIMITS = { title: 200, body: 20000, comment: 10000, labelName: 50, listName: 100 } as const;

export const TRACKER_STATES: TrackerIssueState[] = ['open', 'in_progress', 'blocked', 'closed'];
export const TRACKER_PRIORITIES: TrackerIssuePriority[] = ['low', 'normal', 'high', 'urgent'];

const PERMISSION_KEYS = {
  tracker: { create: 'CREATE_ISSUES', comment: 'COMMENT_ON_ISSUES', assign: 'ASSIGN_ISSUES', manage: 'MANAGE_ISSUES' },
  board: { create: 'CREATE_CARDS', comment: 'COMMENT_ON_CARDS', assign: 'ASSIGN_CARDS', manage: 'MANAGE_BOARDS' },
} as const;

export interface WorkItemPermissions {
  create: boolean;
  comment: boolean;
  assign: boolean;
  manage: boolean;
  /** Upload attachments (issues only; also needs comment). */
  attach: boolean;
}

/** What the current user may do in this channel; mirrors the checks the realm server enforces. */
export function useWorkItemPermissions(kind: WorkKind, channel: Channel): WorkItemPermissions {
  const user = useAuthStore((s) => s.user);
  const channelKeys = channel.effective_permission_keys;
  return useMemo(() => {
    const names = PERMISSION_KEYS[kind];
    // The realm owner bypasses channel permissions.
    const owner = !!(user?.isOwner || user?.role === 'owner');
    const has = (key: string) => owner || hasChannelPermissionKey(user?.permissionKeys, channelKeys, key);
    return {
      create: has(names.create),
      comment: has(names.comment),
      assign: has(names.assign),
      manage: has(names.manage),
      attach: has('ATTACH_FILES'),
    };
  }, [kind, user?.isOwner, user?.role, user?.permissionKeys, channelKeys]);
}

function tokenUserId(token: string | null | undefined): string | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as { id?: unknown };
    return typeof payload.id === 'string' ? payload.id : null;
  } catch {
    return null;
  }
}

/** The signed-in user's id on the active realm (Central accounts have a realm-local id). */
export function useSelfUserId(): string | null {
  const user = useAuthStore((s) => s.user);
  const activeServerToken = useServerStore((s) => (s.activeServerId ? s.byId(s.activeServerId)?.token ?? null : null));
  return useMemo(() => {
    if (!user) return null;
    if (user.accountType !== 'central') return user.id;
    return tokenUserId(activeServerToken) ?? user.serverUserId ?? user.id;
  }, [user, activeServerToken]);
}

export function userLabel(user: WorkItemUser | null | undefined, deletedLabel = 'Deleted user') {
  return user ? (user.display_name || user.username) : deletedLabel;
}

/** Compact age of a unix-seconds timestamp ("5m", "3d", "2y"); always reads as "… ago". */
export function relativeTime(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  const minutes = Math.max(1, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

export function formatDueDate(dueAt: number): string {
  const date = new Date(dueAt * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function isOverdue(dueAt: number | null, closed = false) {
  return !!dueAt && !closed && dueAt * 1000 < Date.now();
}

// Due dates are picked as a day and stored as the end of that local day (same as desktop).
export function dueInputValue(dueAt: number | null) {
  if (!dueAt) return '';
  const date = new Date(dueAt * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses YYYY-MM-DD; undefined when the text is not a real date, null when empty. */
export function dueFromInput(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day, 23, 59, 59);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return Math.floor(date.getTime() / 1000);
}

export function dueInDays(days: number): number {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(23, 59, 59, 0);
  return Math.floor(date.getTime() / 1000);
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

export async function setItemAssignees(kind: WorkKind, item: WorkItem, userIds: string[]) {
  const res = await createApi().put<WorkItem>(`${workItemPath(kind, item.channel_id, item.id)}/assignees`, { userIds });
  storeItem(kind, res.data);
  return res.data;
}

/** Realm uploads are stored as paths; turn one into a loadable URL. */
export function resolveRealmUrl(value: string | null | undefined, serverUrl: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return `${(serverUrl ?? '').replace(/\/+$/, '')}${value.startsWith('/') ? value : `/${value}`}`;
}
