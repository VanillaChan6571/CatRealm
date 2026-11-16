import { useMemo, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, ArrowRight, CalendarClock, CircleAlert, CircleCheck, CircleDot, Paperclip, Pencil, Settings2, Tag, Trash2, UserRound } from 'lucide-react';
import { createApi } from '../../lib/api';
import {
  apiErrorMessage, useWorkItemStore, workItemPath, type WorkItem, type WorkKind,
} from '../../stores/workItemStore';
import {
  WORK_ITEM_LIMITS, fieldClass, patchItem, relativeTime, storeItem, toggleId, useMemberOptions, useRealmUrl, userLabel,
  type WorkItemPermissions,
} from './workItemUtils';
import type {
  BoardList, Channel, WorkItemComment, WorkItemDetail, WorkItemEvent, WorkItemLabel, WorkItemUser,
} from '../../types';
import { Button } from '../ui/Button';
import { MessageFormatter } from '../chat/MessageFormatter';
import { confirmAction } from './confirmAction';
import { LabelChip, LabelChips, LabelPickerList, MemberPickerList, Popover, UserAvatar } from './shared';

// Detail pieces shared by the issue page and the card modal: title, description,
// labels/assignees and the comment + activity timeline.

const EMPTY_LISTS: BoardList[] = [];

export function EditableTitle({ title, canEdit, onSave, className = '' }: {
  title: string;
  canEdit: boolean;
  onSave: (title: string) => Promise<unknown>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === title) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to rename'));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className={`group flex items-start gap-2 ${className}`}>
        <h2 className="min-w-0 break-words text-xl font-bold text-text-primary">{title}</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setDraft(title); setEditing(true); }}
            className="mt-1 shrink-0 rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-primary group-hover:opacity-100 focus:opacity-100"
            title="Edit title"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          maxLength={WORK_ITEM_LIMITS.title}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
            if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); }
          }}
          className={`${fieldClass} text-base font-semibold`}
        />
        <Button size="sm" onClick={() => void save()} disabled={saving || !draft.trim()}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function EditableBody({ body, canEdit, onSave, emptyText = 'No description provided.' }: {
  body: string;
  canEdit: boolean;
  onSave: (body: string) => Promise<unknown>;
  emptyText?: string;
}) {
  const serverUrl = useRealmUrl();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div>
        <textarea
          autoFocus
          value={draft}
          maxLength={WORK_ITEM_LIMITS.body}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save();
            if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); }
          }}
          rows={8}
          placeholder="Add a description…"
          className={`${fieldClass} resize-y`}
        />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="group relative">
      {body
        ? <MessageFormatter text={body} allowLinks allowEmbeds={false} serverUrl={serverUrl} className="text-sm text-text-secondary" />
        : <p className="text-sm italic text-text-muted">{emptyText}</p>}
      {canEdit && (
        <button
          type="button"
          onClick={() => { setDraft(body); setEditing(true); }}
          className="absolute -top-1 right-0 rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-primary group-hover:opacity-100 focus:opacity-100"
          title="Edit description"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function SidebarField({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-border/60 pb-3 last:border-b-0">
      <div className="relative mb-1.5 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Labels and assignees with their pickers. `canEdit` is "author or manager"; assigning has its own permission. */
export function ItemFields({ kind, item, labels, perms, canEdit, onManageLabels, children }: {
  kind: WorkKind;
  item: WorkItem;
  labels: WorkItemLabel[];
  perms: WorkItemPermissions;
  canEdit: boolean;
  onManageLabels?: () => void;
  children?: ReactNode;
}) {
  const members = useMemberOptions();
  const [open, setOpen] = useState<'labels' | 'assignees' | null>(null);
  const [error, setError] = useState('');
  const assigneeIds = item.assignees.map((user) => user.id);

  const setLabelIds = (labelIds: string[]) => {
    patchItem(kind, item, { labelIds }).then(() => setError('')).catch((err) => setError(apiErrorMessage(err, 'Failed to update labels')));
  };
  const setAssignees = (userIds: string[]) => {
    createApi().put<WorkItem>(`${workItemPath(kind, item.channel_id, item.id)}/assignees`, { userIds })
      .then((res) => { storeItem(kind, res.data); setError(''); })
      .catch((err) => setError(apiErrorMessage(err, 'Failed to update assignees')));
  };
  // Assigned people who are not in the member list (left the realm) still need a row to be removable.
  const memberOptions = useMemo(() => {
    const known = new Set(members.map((member) => member.id));
    return [...item.assignees.filter((user) => !known.has(user.id)), ...members];
  }, [members, item.assignees]);

  const gear = (target: 'labels' | 'assignees') => (
    <button
      type="button"
      onClick={() => setOpen(open === target ? null : target)}
      className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary"
      title={`Edit ${target}`}
    >
      <Settings2 className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div className="space-y-3">
      <SidebarField
        title="Assignees"
        action={perms.assign && (
          <>
            {gear('assignees')}
            <Popover open={open === 'assignees'} onClose={() => setOpen(null)} align="right">
              <MemberPickerList members={memberOptions} selected={assigneeIds} onToggle={(id) => setAssignees(toggleId(assigneeIds, id))} />
            </Popover>
          </>
        )}
      >
        {item.assignees.length === 0
          ? <p className="text-sm text-text-muted">No one assigned</p>
          : (
            <div className="space-y-1.5">
              {item.assignees.map((user) => (
                <div key={user.id} className="flex items-center gap-2 text-sm text-text-primary">
                  <UserAvatar user={user} size={20} />
                  <span className="truncate">{userLabel(user)}</span>
                </div>
              ))}
            </div>
          )}
      </SidebarField>

      <SidebarField
        title="Labels"
        action={canEdit && (
          <>
            {gear('labels')}
            <Popover open={open === 'labels'} onClose={() => setOpen(null)} align="right">
              <LabelPickerList
                labels={labels}
                selected={item.label_ids}
                onToggle={(id) => setLabelIds(toggleId(item.label_ids, id))}
                onManage={onManageLabels ? () => { setOpen(null); onManageLabels(); } : undefined}
              />
            </Popover>
          </>
        )}
      >
        {item.label_ids.length === 0
          ? <p className="text-sm text-text-muted">None yet</p>
          : <LabelChips labelIds={item.label_ids} labels={labels} />}
      </SidebarField>

      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

type TimelineEntry =
  | { kind: 'comment'; at: number; comment: WorkItemComment }
  | { kind: 'event'; at: number; event: WorkItemEvent };

const EVENT_ICONS: Record<WorkItemEvent['type'], ReactNode> = {
  renamed: <Pencil className="h-3.5 w-3.5" />,
  closed: <CircleCheck className="h-3.5 w-3.5 text-accent" />,
  reopened: <CircleDot className="h-3.5 w-3.5 text-success" />,
  labels: <Tag className="h-3.5 w-3.5" />,
  assignees: <UserRound className="h-3.5 w-3.5" />,
  moved: <ArrowRight className="h-3.5 w-3.5" />,
  archived: <Archive className="h-3.5 w-3.5" />,
  restored: <ArchiveRestore className="h-3.5 w-3.5" />,
  state: <CircleDot className="h-3.5 w-3.5" />,
  priority: <CircleAlert className="h-3.5 w-3.5" />,
  due_date: <CalendarClock className="h-3.5 w-3.5" />,
  attachment_added: <Paperclip className="h-3.5 w-3.5" />,
  attachment_removed: <Paperclip className="h-3.5 w-3.5" />,
};

function EventRow({ event, noun, labels, lists, userName }: {
  event: WorkItemEvent;
  noun: string;
  labels: WorkItemLabel[];
  lists: BoardList[];
  userName: (id: string | null | undefined) => string;
}) {
  const labelChips = (ids: string[] | undefined) => (ids ?? []).map((id) => {
    const label = labels.find((l) => l.id === id);
    return label ? <LabelChip key={id} label={label} compact /> : <span key={id} className="text-text-muted">a deleted label</span>;
  });
  const names = (ids: string[] | undefined) => (ids ?? []).map((id) => userName(id)).join(', ');
  const listName = (id: string | number | null | undefined) => lists.find((list) => list.id === id)?.name ?? 'a deleted list';
  const added = event.data?.added ?? [];
  const removed = event.data?.removed ?? [];

  let text: ReactNode;
  switch (event.type) {
    case 'renamed':
      text = <>changed the title from <s className="text-text-muted">{event.data?.from}</s> to <b className="text-text-primary">{event.data?.to}</b></>;
      break;
    case 'closed': text = `closed this ${noun}`; break;
    case 'reopened': text = `reopened this ${noun}`; break;
    case 'archived': text = `archived this ${noun}`; break;
    case 'restored': text = `restored this ${noun}`; break;
    case 'moved':
      text = <>moved this from <b className="text-text-primary">{listName(event.data?.from)}</b> to <b className="text-text-primary">{listName(event.data?.to)}</b></>;
      break;
    case 'state':
      text = <>changed status from <b className="text-text-primary">{String(event.data?.from ?? '')}</b> to <b className="text-text-primary">{String(event.data?.to ?? '')}</b></>;
      break;
    case 'priority':
      text = <>changed priority from <b className="text-text-primary">{String(event.data?.from ?? '')}</b> to <b className="text-text-primary">{String(event.data?.to ?? '')}</b></>;
      break;
    case 'due_date': {
      const date = (value: string | number | null | undefined) => typeof value === 'number' ? new Date(value * 1000).toLocaleDateString() : 'none';
      text = <>changed due date from <b className="text-text-primary">{date(event.data?.from)}</b> to <b className="text-text-primary">{date(event.data?.to)}</b></>;
      break;
    }
    case 'attachment_added': text = <>attached <b className="text-text-primary">{event.data?.name}</b></>; break;
    case 'attachment_removed': text = <>removed attachment <b className="text-text-primary">{event.data?.name}</b></>; break;
    case 'labels':
      text = (
        <>
          {added.length > 0 && <>added {labelChips(added)} </>}
          {added.length > 0 && removed.length > 0 && 'and '}
          {removed.length > 0 && <>removed {labelChips(removed)}</>}
        </>
      );
      break;
    case 'assignees':
      text = (
        <>
          {added.length > 0 && <>assigned <b className="text-text-primary">{names(added)}</b> </>}
          {added.length > 0 && removed.length > 0 && 'and '}
          {removed.length > 0 && <>unassigned <b className="text-text-primary">{names(removed)}</b></>}
        </>
      );
      break;
  }
  return (
    <div className="flex items-start gap-2 py-1.5 pl-1.5 text-xs text-text-muted">
      <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-elevated">{EVENT_ICONS[event.type]}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 leading-5">
        <b className="font-semibold text-text-secondary">{userName(event.actor_id)}</b>
        {text}
        <span>· {relativeTime(event.created_at)}</span>
      </span>
    </div>
  );
}

function CommentRow({ kind, item, comment, selfId, canManage }: {
  kind: WorkKind;
  item: WorkItem;
  comment: WorkItemComment;
  selfId: string | null;
  canManage: boolean;
}) {
  const serverUrl = useRealmUrl();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState('');
  const isAuthor = !!selfId && comment.user_id === selfId;
  const path = `${workItemPath(kind, item.channel_id, item.id)}/comments/${comment.id}`;

  const save = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      const res = await createApi().patch<WorkItemComment>(path, { body });
      useWorkItemStore.getState().applyComment(kind, item.channel_id, item.id, res.data);
      setEditing(false);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to edit comment'));
    }
  };
  const remove = async () => {
    if (!(await confirmAction({ title: 'Delete comment', message: 'Delete this comment? This cannot be undone.' }))) return;
    try {
      await createApi().delete(path);
      useWorkItemStore.getState().removeComment(kind, item.channel_id, item.id, comment.id);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete comment'));
    }
  };

  return (
    <div className="group flex gap-2.5 py-2">
      <UserAvatar user={comment.author} size={28} />
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-bg-elevated/60">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs text-text-muted">
          <b className="font-semibold text-text-primary">{userLabel(comment.author)}</b>
          <span>{relativeTime(comment.created_at)}</span>
          {comment.edited_at && <span>(edited)</span>}
          <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {isAuthor && (
              <button type="button" onClick={() => { setDraft(comment.body); setEditing(true); }} className="rounded p-1 hover:bg-bg-hover hover:text-text-primary" title="Edit comment">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {(isAuthor || canManage) && (
              <button type="button" onClick={() => void remove()} className="rounded p-1 hover:bg-danger/15 hover:text-danger" title="Delete comment">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        </div>
        <div className="px-3 py-2">
          {editing ? (
            <>
              <textarea
                autoFocus
                value={draft}
                maxLength={WORK_ITEM_LIMITS.comment}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save();
                  if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); }
                }}
                rows={3}
                className={`${fieldClass} resize-y`}
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void save()} disabled={!draft.trim()}>Save</Button>
              </div>
            </>
          ) : (
            <MessageFormatter text={comment.body} allowLinks allowEmbeds={false} serverUrl={serverUrl} className="text-sm text-text-secondary" />
          )}
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Comments and activity in one chronological list, plus the comment box.
 * `extraActions` renders beside the Comment button (e.g. Close issue) and receives
 * the draft so a state change can post the pending comment first.
 */
export function ItemTimeline({ kind, channel, item, detail, labels, perms, selfId, extraActions }: {
  kind: WorkKind;
  channel: Channel;
  item: WorkItem;
  detail: WorkItemDetail | undefined;
  labels: WorkItemLabel[];
  perms: WorkItemPermissions;
  selfId: string | null;
  extraActions?: (submitDraft: () => Promise<boolean>) => ReactNode;
}) {
  const members = useMemberOptions();
  const lists = useWorkItemStore((s) => s.boards[channel.id]?.lists) ?? EMPTY_LISTS;
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const noun = kind === 'tracker' ? 'issue' : 'card';

  const entries = useMemo<TimelineEntry[]>(() => {
    if (!detail) return [];
    return [
      ...detail.comments.map((comment) => ({ kind: 'comment' as const, at: comment.created_at, comment })),
      ...detail.events.map((event) => ({ kind: 'event' as const, at: event.created_at, event })),
    ].sort((a, b) => a.at - b.at);
  }, [detail]);

  const userName = (id: string | null | undefined) => {
    if (!id) return 'Someone';
    const known: WorkItemUser | undefined = members.find((member) => member.id === id)
      ?? item.assignees.find((user) => user.id === id)
      ?? (item.author?.id === id ? item.author : undefined);
    return known ? userLabel(known) : 'Former member';
  };

  // Resolves true when there was nothing to post or the comment was posted.
  const submit = async () => {
    const body = draft.trim();
    if (!body) return true;
    setPosting(true);
    try {
      const res = await createApi().post<WorkItemComment>(`${workItemPath(kind, item.channel_id, item.id)}/comments`, { body });
      useWorkItemStore.getState().applyComment(kind, item.channel_id, item.id, res.data);
      setDraft('');
      setError('');
      return true;
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to post comment'));
      return false;
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      {!detail && <p className="py-3 text-sm text-text-muted">Loading activity…</p>}
      {entries.map((entry) => (entry.kind === 'comment'
        ? <CommentRow key={`c-${entry.comment.id}`} kind={kind} item={item} comment={entry.comment} selfId={selfId} canManage={perms.manage} />
        : <EventRow key={`e-${entry.event.id}`} event={entry.event} noun={noun} labels={labels} lists={lists} userName={userName} />
      ))}

      {perms.comment ? (
        <div className="mt-2">
          <textarea
            value={draft}
            maxLength={WORK_ITEM_LIMITS.comment}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit(); }}
            rows={3}
            placeholder="Leave a comment…  (Ctrl+Enter to post)"
            className={`${fieldClass} resize-y`}
          />
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            {extraActions?.(submit)}
            <Button size="sm" onClick={() => void submit()} disabled={posting || !draft.trim()}>Comment</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 rounded-md border border-border bg-bg-elevated/50 px-3 py-2 text-xs text-text-muted">
            You do not have permission to comment here.
          </p>
          {extraActions && <div className="mt-2 flex justify-end gap-2">{extraActions(async () => true)}</div>}
        </>
      )}
    </div>
  );
}
