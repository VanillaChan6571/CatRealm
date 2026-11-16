import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Bell, CalendarClock, ChevronDown, CircleAlert, CircleCheck, CircleDot, CirclePause, MessageSquare, Paperclip, Plus, Search, Settings2, Tag, Trash2, X } from 'lucide-react';
import { createApi } from '../../lib/api';
import { useMarkChannelReadWhileOpen } from '../../hooks/useMarkChannelReadWhileOpen';
import {
  DEFAULT_TRACKER_FILTER, EMPTY_TRACKER, apiErrorMessage, useWorkItemStore, workItemPath, type TrackerFilter,
} from '../../stores/workItemStore';
import type { Channel, TrackerIssue, WorkItemLabel } from '../../types';
import { ServerMentionProvider } from '../chat/mentions';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { EditableBody, EditableTitle, ItemFields, ItemTimeline } from './ItemDetail';
import { ConfirmHost } from './ConfirmHost';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { confirmAction } from './confirmAction';
import { LabelManagerModal } from './LabelManagerModal';
import { WorkChannelBackdrop } from './WorkChannelBackdrop';
import { WorkChannelSettingsModal } from './WorkChannelSettingsModal';
import { AvatarStack, LabelChips, LabelPickerList, MemberPickerList, Popover, UserAvatar } from './shared';
import {
  WORK_ITEM_LIMITS, fieldClass, patchItem, relativeTime, resolveRealmImage, toggleId, useMemberOptions, userLabel, useSelfUserId,
  useWorkItemPermissions, useRealmUrl, type WorkItemPermissions,
} from './workItemUtils';

/** A tracker channel: the issue list, or one issue when it is open. */
export function TrackerChannel({ channel }: { channel: Channel }) {
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [managingLabels, setManagingLabels] = useState(false);
  const tracker = useWorkItemStore((s) => s.trackers[channel.id]) ?? EMPTY_TRACKER;
  const { labels, settings, counts } = tracker;
  const fetchLabels = useWorkItemStore((s) => s.fetchLabels);
  const perms = useWorkItemPermissions('tracker', channel);
  const serverUrl = useRealmUrl();
  const [showTrackerSettings, setShowTrackerSettings] = useState(false);
  const [trackerMenu, setTrackerMenu] = useState<{ x: number; y: number } | null>(null);
  const displayTitle = settings.title || channel.name;
  useMarkChannelReadWhileOpen(channel.id);

  useEffect(() => { void fetchLabels('tracker', channel.id); }, [channel.id, fetchLabels]);

  return (
    <ServerMentionProvider>
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-chat"
        onContextMenu={(event) => {
          if (!perms.manage || (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
          event.preventDefault();
          setTrackerMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <WorkChannelBackdrop background={settings.background} serverUrl={serverUrl} />
        <div className="relative flex min-h-0 flex-1 flex-col">
        {openIssueId ? (
          <IssueView
            channel={channel}
            displayTitle={displayTitle}
            hasBackground={!!settings.background}
            issueId={openIssueId}
            labels={labels}
            perms={perms}
            onBack={() => setOpenIssueId(null)}
            onManageLabels={perms.manage ? () => setManagingLabels(true) : undefined}
          />
        ) : (
          <IssueList
            channel={channel}
            displayTitle={displayTitle}
            totalIssues={counts.open + (counts.in_progress ?? 0) + (counts.blocked ?? 0) + counts.closed}
            hasBackground={!!settings.background}
            perms={perms}
            onOpen={setOpenIssueId}
            onManageLabels={() => setManagingLabels(true)}
          />
        )}
        </div>
      </div>
      {trackerMenu && (
        <ContextMenu
          x={trackerMenu.x}
          y={trackerMenu.y}
          entries={[
            { label: 'Tracker settings…', icon: <Settings2 className="h-4 w-4" />, onSelect: () => setShowTrackerSettings(true) },
            { label: 'Edit labels…', icon: <Tag className="h-4 w-4" />, onSelect: () => setManagingLabels(true) },
          ] satisfies ContextMenuEntry[]}
          onClose={() => setTrackerMenu(null)}
        />
      )}
      {showTrackerSettings && (
        <WorkChannelSettingsModal
          kind="tracker"
          channelId={channel.id}
          channelName={channel.name}
          settings={settings}
          serverUrl={serverUrl}
          onClose={() => setShowTrackerSettings(false)}
        />
      )}
      <LabelManagerModal kind="tracker" channelId={channel.id} labels={labels} open={managingLabels} onClose={() => setManagingLabels(false)} />
      <ConfirmHost />
    </ServerMentionProvider>
  );
}

function StateIcon({ state, className = 'h-4 w-4' }: { state: TrackerIssue['state']; className?: string }) {
  const iconClass = `${className} shrink-0`;
  switch (state) {
    case 'in_progress': return <CirclePause className={`${iconClass} text-sky-400`} />;
    case 'blocked': return <CircleAlert className={`${iconClass} text-warning`} />;
    case 'closed': return <CircleCheck className={`${iconClass} text-accent`} />;
    default: return <CircleDot className={`${iconClass} text-success`} />;
  }
}

const STATE_LABELS: Record<TrackerIssue['state'], string> = {
  open: 'Open', in_progress: 'In progress', blocked: 'Blocked', closed: 'Closed',
};
const PRIORITY_LABELS: Record<TrackerIssue['priority'], string> = {
  low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent',
};
const PRIORITY_CLASSES: Record<TrackerIssue['priority'], string> = {
  low: 'text-text-muted', normal: 'text-text-secondary', high: 'text-warning', urgent: 'text-danger',
};

function dueInputValue(dueAt: number | null) {
  if (!dueAt) return '';
  const date = new Date(dueAt * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dueFromInput(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(new Date(year, month - 1, day, 23, 59, 59).getTime() / 1000);
}

function FilterButton({ label, active, children }: { label: string; active: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors hover:bg-bg-hover ${active ? 'font-semibold text-accent' : 'text-text-muted hover:text-text-primary'}`}
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right">
        {children(() => setOpen(false))}
      </Popover>
    </span>
  );
}

function IssueList({ channel, displayTitle, totalIssues, hasBackground, perms, onOpen, onManageLabels }: {
  channel: Channel;
  displayTitle: string;
  totalIssues: number;
  hasBackground: boolean;
  perms: WorkItemPermissions;
  onOpen: (issueId: string) => void;
  onManageLabels: () => void;
}) {
  const tracker = useWorkItemStore((s) => s.trackers[channel.id]) ?? EMPTY_TRACKER;
  const fetchIssues = useWorkItemStore((s) => s.fetchIssues);
  const setTrackerFilter = useWorkItemStore((s) => s.setTrackerFilter);
  const members = useMemberOptions();
  const { filter, issues, counts, labels, refreshNonce } = tracker;
  const [search, setSearch] = useState(filter.q);
  const [creating, setCreating] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void fetchIssues(channel.id);
  }, [channel.id, filter, refreshNonce, fetchIssues]);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    if (search === filter.q) return;
    const timer = window.setTimeout(() => setTrackerFilter(channel.id, { q: search }), 250);
    return () => window.clearTimeout(timer);
  }, [search, filter.q, channel.id, setTrackerFilter]);

  const setFilter = (patch: Partial<TrackerFilter>) => setTrackerFilter(channel.id, patch);
  const filtered = !!(filter.label || filter.assignee || filter.author || filter.q.trim() || !['active', 'closed'].includes(filter.state));
  const stateTab = (state: 'active' | 'closed', icon: ReactNode, text: string, count: number) => (
    <button
      type="button"
      onClick={() => setFilter({ state })}
      className={`flex items-center gap-1.5 rounded px-2 py-1 text-sm transition-colors hover:bg-bg-hover ${filter.state === state ? 'font-semibold text-text-primary' : 'text-text-muted'}`}
    >
      {icon}
      {count} {text}
    </button>
  );

  return (
    <>
      <div className={`flex shrink-0 items-center gap-3 px-4 pb-2 pt-3 ${hasBackground ? 'bg-black/25 backdrop-blur-sm' : ''}`}>
        <h2 className="min-w-0 truncate text-lg font-semibold text-text-primary">{displayTitle}</h2>
        <span className="ml-auto shrink-0 text-sm text-text-muted">{totalIssues} {totalIssues === 1 ? 'issue' : 'issues'}</span>
      </div>
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search issue titles…"
            className={`${fieldClass} pl-9`}
          />
        </div>
        {perms.manage && (
          <Button variant="secondary" onClick={onManageLabels} className="flex shrink-0 items-center gap-1.5">
            <Tag className="h-4 w-4" /> Labels
          </Button>
        )}
        {perms.create && (
          <Button onClick={() => setCreating(true)} className="flex shrink-0 items-center gap-1.5">
            <Plus className="h-4 w-4" /> New issue
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className={`rounded-lg border border-border ${hasBackground ? 'bg-bg-chat/85 backdrop-blur-sm' : ''}`}>
          <div className="flex flex-wrap items-center gap-1 rounded-t-lg border-b border-border bg-bg-elevated px-2 py-1.5">
            {stateTab('active', <CircleDot className="h-4 w-4" />, 'Active', counts.open + (counts.in_progress ?? 0) + (counts.blocked ?? 0))}
            {stateTab('closed', <CircleCheck className="h-4 w-4" />, 'Closed', counts.closed)}
            <span className="ml-auto flex items-center">
              {filtered && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setFilter(DEFAULT_TRACKER_FILTER); }}
                  className="mr-1 flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary"
                >
                  <X className="h-3.5 w-3.5" /> Clear filters
                </button>
              )}
              <FilterButton label={['open', 'in_progress', 'blocked'].includes(filter.state) ? STATE_LABELS[filter.state as TrackerIssue['state']] : 'Status'} active={!['active', 'closed'].includes(filter.state)}>
                {(close) => (
                  <div className="space-y-0.5">
                    {(['active', 'open', 'in_progress', 'blocked', 'closed', 'all'] as const).map((state) => (
                      <button key={state} type="button" onClick={() => { setFilter({ state }); close(); }}
                        className={`block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-bg-hover ${filter.state === state ? 'text-accent' : 'text-text-secondary'}`}>
                        {state === 'active' ? 'All active' : state === 'all' ? 'All issues' : STATE_LABELS[state]}
                      </button>
                    ))}
                  </div>
                )}
              </FilterButton>
              <FilterButton label="Label" active={!!filter.label}>
                {(close) => (
                  <LabelPickerList
                    labels={labels}
                    selected={filter.label ? [filter.label] : []}
                    onToggle={(id) => { setFilter({ label: filter.label === id ? '' : id }); close(); }}
                  />
                )}
              </FilterButton>
              <FilterButton label="Assignee" active={!!filter.assignee}>
                {(close) => (
                  <MemberPickerList
                    members={members}
                    selected={filter.assignee ? [filter.assignee] : []}
                    onToggle={(id) => { setFilter({ assignee: filter.assignee === id ? '' : id }); close(); }}
                  />
                )}
              </FilterButton>
              <FilterButton label="Author" active={!!filter.author}>
                {(close) => (
                  <MemberPickerList
                    members={members}
                    selected={filter.author ? [filter.author] : []}
                    onToggle={(id) => { setFilter({ author: filter.author === id ? '' : id }); close(); }}
                  />
                )}
              </FilterButton>
            </span>
          </div>

          {tracker.error && <p className="px-4 py-6 text-center text-sm text-danger">{tracker.error}</p>}
          {!tracker.error && !tracker.loaded && <p className="px-4 py-10 text-center text-sm text-text-muted">Loading issues…</p>}
          {!tracker.error && tracker.loaded && issues.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
              <CircleDot className="h-8 w-8 text-text-muted" />
              <p className="font-semibold text-text-primary">
                {filtered ? 'No issues match these filters.' : filter.state === 'closed' ? 'No closed issues.' : 'No active issues.'}
              </p>
              {!filtered && filter.state === 'active' && perms.create && (
                <p className="text-sm text-text-muted">Report a bug or track a task with <b>New issue</b>.</p>
              )}
            </div>
          )}

          {issues.map((issue) => (
            <button
              key={issue.id}
              type="button"
              onClick={() => onOpen(issue.id)}
              className="flex w-full items-start gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:rounded-b-lg last:border-b-0 hover:bg-bg-hover/40"
            >
              <StateIcon state={issue.state} className="mt-0.5 h-4 w-4" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="break-words font-semibold text-text-primary">{issue.title}</span>
                  {issue.priority && issue.priority !== 'normal' && <span className={`text-xs font-semibold ${PRIORITY_CLASSES[issue.priority]}`}>{PRIORITY_LABELS[issue.priority]}</span>}
                  <LabelChips labelIds={issue.label_ids} labels={labels} />
                </span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  #{issue.number}
                  {' · '}{STATE_LABELS[issue.state]}
                  {issue.state === 'closed' && issue.closed_at
                    ? ` · closed ${relativeTime(issue.closed_at)}`
                    : ` · opened ${relativeTime(issue.created_at)} by ${userLabel(issue.author)}`}
                </span>
                {issue.due_at && <span className={`mt-1 flex items-center gap-1 text-xs ${issue.due_at * 1000 < nowMs && issue.state !== 'closed' ? 'text-danger' : 'text-text-muted'}`}><CalendarClock className="h-3.5 w-3.5" /> Due {new Date(issue.due_at * 1000).toLocaleDateString()}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3 pt-0.5">
                <AvatarStack users={issue.assignees} />
                {issue.comment_count > 0 && (
                  <span className="flex items-center gap-1 text-xs text-text-muted">
                    <MessageSquare className="h-3.5 w-3.5" /> {issue.comment_count}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        {tracker.hasMore && (
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" size="sm" disabled={tracker.loading} onClick={() => void fetchIssues(channel.id, { append: true })}>
              {tracker.loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>

      <NewIssueModal
        channel={channel}
        labels={labels}
        perms={perms}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(issue) => { setCreating(false); onOpen(issue.id); }}
      />
    </>
  );
}

function NewIssueModal({ channel, labels, perms, open, onClose, onCreated }: {
  channel: Channel;
  labels: WorkItemLabel[];
  perms: WorkItemPermissions;
  open: boolean;
  onClose: () => void;
  onCreated: (issue: TrackerIssue) => void;
}) {
  const members = useMemberOptions();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<TrackerIssue['priority']>('normal');
  const [dueDate, setDueDate] = useState('');
  const [picker, setPicker] = useState<'labels' | 'assignees' | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await createApi().post<TrackerIssue>(workItemPath('tracker', channel.id), {
        title: title.trim(),
        body: body.trim(),
        priority,
        dueAt: dueFromInput(dueDate),
        ...(labelIds.length ? { labelIds } : {}),
        ...(assigneeIds.length ? { assigneeIds } : {}),
      });
      useWorkItemStore.getState().applyIssue(res.data, true);
      setTitle(''); setBody(''); setLabelIds([]); setAssigneeIds([]); setPriority('normal'); setDueDate(''); setError('');
      onCreated(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create issue'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New issue" className="max-w-2xl">
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-3">
        <input
          autoFocus
          value={title}
          maxLength={WORK_ITEM_LIMITS.title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
          className={fieldClass}
        />
        <textarea
          value={body}
          maxLength={WORK_ITEM_LIMITS.body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit(); }}
          rows={8}
          placeholder="Describe the issue… (optional)"
          className={`${fieldClass} resize-y`}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value as TrackerIssue['priority'])} className={`${fieldClass} mt-1 py-1.5`}>
              {(Object.keys(PRIORITY_LABELS) as TrackerIssue['priority'][]).map((value) => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Due date
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={`${fieldClass} mt-1 py-1.5`} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="relative">
            <Button type="button" size="sm" variant="secondary" onClick={() => setPicker(picker === 'labels' ? null : 'labels')}>
              Labels{labelIds.length > 0 && ` (${labelIds.length})`}
            </Button>
            <Popover open={picker === 'labels'} onClose={() => setPicker(null)}>
              <LabelPickerList labels={labels} selected={labelIds} onToggle={(id) => setLabelIds(toggleId(labelIds, id))} />
            </Popover>
          </span>
          {perms.assign && (
            <span className="relative">
              <Button type="button" size="sm" variant="secondary" onClick={() => setPicker(picker === 'assignees' ? null : 'assignees')}>
                Assignees{assigneeIds.length > 0 && ` (${assigneeIds.length})`}
              </Button>
              <Popover open={picker === 'assignees'} onClose={() => setPicker(null)}>
                <MemberPickerList members={members} selected={assigneeIds} onToggle={(id) => setAssigneeIds(toggleId(assigneeIds, id))} />
              </Popover>
            </span>
          )}
          <LabelChips labelIds={labelIds} labels={labels} />
          <AvatarStack users={members.filter((member) => assigneeIds.includes(member.id))} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !title.trim()}>{saving ? 'Creating…' : 'Create issue'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function IssueView({ channel, displayTitle, hasBackground, issueId, labels, perms, onBack, onManageLabels }: {
  channel: Channel;
  displayTitle: string;
  hasBackground: boolean;
  issueId: string;
  labels: WorkItemLabel[];
  perms: WorkItemPermissions;
  onBack: () => void;
  onManageLabels?: () => void;
}) {
  const issue = useWorkItemStore((s) => s.openItems[issueId]) as TrackerIssue | undefined;
  const detail = useWorkItemStore((s) => s.details[issueId]);
  const fetchDetail = useWorkItemStore((s) => s.fetchDetail);
  const closeDetail = useWorkItemStore((s) => s.closeDetail);
  const selfId = useSelfUserId();
  const serverUrl = useRealmUrl();
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const updatedAt = issue?.updated_at;

  // Refetched whenever the issue changes so the activity timeline stays current.
  useEffect(() => {
    let cancelled = false;
    fetchDetail('tracker', channel.id, issueId)
      .then(() => { if (!cancelled) setError(''); })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, 'Failed to load issue')); });
    return () => { cancelled = true; };
  }, [channel.id, issueId, updatedAt, fetchDetail]);

  useEffect(() => () => closeDetail(issueId), [issueId, closeDetail]);

  const header = (
    <div className={`flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 shadow-sm ${hasBackground ? 'bg-bg-chat/90 backdrop-blur-sm' : ''}`}>
      <button type="button" onClick={onBack} className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary" title="Back to issues">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <span className="truncate text-sm text-text-muted">
        {displayTitle}{issue && <> / <b className="text-text-primary">#{issue.number}</b></>}
      </span>
    </div>
  );

  if (!issue) {
    return (
      <>
        {header}
        <p className={`px-4 py-10 text-center text-sm ${error ? 'text-danger' : 'text-text-muted'}`}>
          {error ? `${error}. It may have been deleted.` : 'Loading issue…'}
        </p>
      </>
    );
  }

  const canEdit = perms.manage || (!!selfId && issue.created_by === selfId);
  // Someone the issue is assigned to may move it along, even if they cannot edit it.
  const canSetState = canEdit || (!!selfId && issue.assignees.some((user) => user.id === selfId));
  const setState = async (state: TrackerIssue['state'], submitDraft?: () => Promise<boolean>) => {
    setBusy(true);
    try {
      if (!submitDraft || await submitDraft()) await patchItem('tracker', issue, { state });
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to update issue'));
    } finally {
      setBusy(false);
    }
  };
  const updateField = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await patchItem('tracker', issue, body);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to update issue'));
    } finally {
      setBusy(false);
    }
  };
  const setWatching = async () => {
    setBusy(true);
    try {
      const path = `${workItemPath('tracker', channel.id, issue.id)}/watch`;
      if (detail?.watching) await createApi().delete(path);
      else await createApi().put(path);
      await fetchDetail('tracker', channel.id, issue.id);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to update watcher setting'));
    } finally {
      setBusy(false);
    }
  };
  const uploadAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    if ((detail?.attachments?.length ?? 0) + files.length > 20) {
      setError('An issue can have up to 20 attachments');
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} exceeds the 50 MB limit`);
        const form = new FormData();
        form.append('file', file);
        await createApi().post(`${workItemPath('tracker', channel.id, issue.id)}/attachments`, form);
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error && !('response' in err) ? err.message : apiErrorMessage(err, 'Failed to upload attachment'));
    } finally {
      if (attachmentInput.current) attachmentInput.current.value = '';
      try { await fetchDetail('tracker', channel.id, issue.id); } catch { /* keep the upload error */ }
      setUploading(false);
    }
  };
  const removeAttachment = async (id: string, name: string) => {
    if (!(await confirmAction({ title: 'Remove attachment', message: `Remove "${name}" from this issue?` }))) return;
    try {
      await createApi().delete(`${workItemPath('tracker', channel.id, issue.id)}/attachments/${id}`);
      await fetchDetail('tracker', channel.id, issue.id);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to remove attachment'));
    }
  };
  const remove = async () => {
    if (!(await confirmAction({ title: 'Delete issue', message: `Delete issue #${issue.number}? This cannot be undone.` }))) return;
    try {
      await createApi().delete(workItemPath('tracker', channel.id, issue.id));
      useWorkItemStore.getState().removeIssue(channel.id, issue.id);
      onBack();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete issue'));
    }
  };

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto max-w-5xl px-6 py-5 ${hasBackground ? 'rounded-lg bg-bg-chat/[0.66]' : ''}`}>
          <EditableTitle title={issue.title} canEdit={canEdit} onSave={(title) => patchItem('tracker', issue, { title })} />
          <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-border pb-4 text-sm text-text-muted">
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white ${issue.state === 'closed' ? 'bg-accent' : issue.state === 'blocked' ? 'bg-warning' : issue.state === 'in_progress' ? 'bg-sky-600' : 'bg-success'}`}>
              <StateIcon state={issue.state} className="h-3.5 w-3.5 text-white" />
              {STATE_LABELS[issue.state]}
            </span>
            <span>
              <b className="font-semibold text-text-secondary">{userLabel(issue.author)}</b> opened this {relativeTime(issue.created_at)}
              {' · '}{issue.comment_count} {issue.comment_count === 1 ? 'comment' : 'comments'}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-6 lg:flex-row">
            <div className="min-w-0 flex-1">
              <div className="flex gap-2.5">
                <UserAvatar user={issue.author} size={28} />
                <div className="min-w-0 flex-1 rounded-lg border border-border bg-bg-elevated/60 px-3 py-2.5">
                  <EditableBody body={issue.body} canEdit={canEdit} onSave={(body) => patchItem('tracker', issue, { body })} />
                </div>
              </div>
              {(!!detail?.attachments?.length || (perms.comment && perms.attach)) && (
                <section className="mt-5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Attachments ({detail?.attachments?.length ?? 0})</h4>
                    {perms.comment && perms.attach && (
                      <>
                        <input ref={attachmentInput} type="file" multiple className="hidden" accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.zip,.7z,.rar,.docx,.xlsx,.pptx" onChange={(event) => void uploadAttachments(event.target.files)} />
                        <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => attachmentInput.current?.click()} className="flex items-center gap-1.5">
                          <Paperclip className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Attach files'}
                        </Button>
                      </>
                    )}
                  </div>
                  {!!detail?.attachments?.length && (
                    <div className="space-y-1.5">
                      {detail.attachments.map((attachment) => (
                        <div key={attachment.id} className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated/60 p-2">
                          {attachment.mime.startsWith('image/')
                            ? <img src={resolveRealmImage(attachment.url, serverUrl)} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                            : <Paperclip className="h-4 w-4 shrink-0 text-text-muted" />}
                          <a href={resolveRealmImage(attachment.url, serverUrl)} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm text-accent hover:underline" title={attachment.name}>{attachment.name}</a>
                          <span className="shrink-0 text-xs text-text-muted">{Math.max(1, Math.ceil(attachment.size / 1024))} KB</span>
                          {(perms.manage || attachment.uploaded_by === selfId) && (
                            <button type="button" title={`Remove ${attachment.name}`} onClick={() => void removeAttachment(attachment.id, attachment.name)} className="rounded p-1 text-text-muted hover:text-danger"><X className="h-4 w-4" /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <div className="mt-2">
                <ItemTimeline
                  key={issue.id}
                  kind="tracker"
                  channel={channel}
                  item={issue}
                  detail={detail}
                  labels={labels}
                  perms={perms}
                  selfId={selfId}
                  extraActions={canSetState ? (submitDraft) => (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void setState(issue.state === 'closed' ? 'open' : 'closed', submitDraft)}
                      className="flex items-center gap-1.5"
                    >
                      {issue.state !== 'closed'
                        ? <><CircleCheck className="h-4 w-4 text-accent" /> Close issue</>
                        : <><CircleDot className="h-4 w-4 text-success" /> Reopen issue</>}
                    </Button>
                  ) : undefined}
                />
              </div>
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </div>

            <aside className="w-full shrink-0 lg:w-60">
              <ItemFields kind="tracker" item={issue} labels={labels} perms={perms} canEdit={canEdit} onManageLabels={onManageLabels}>
                <section className="border-b border-border/60 pb-3">
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Watchers</h4>
                  <button type="button" disabled={busy || !detail} onClick={() => void setWatching()} className="flex items-center gap-1.5 rounded px-1 py-1 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50">
                    <Bell className="h-4 w-4" /> {detail?.watching ? 'Unwatch issue' : 'Watch issue'} · {detail?.watcher_count ?? 0}
                  </button>
                </section>
                <section className="border-b border-border/60 pb-3">
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Status</h4>
                  {canSetState ? (
                    <select value={issue.state} disabled={busy} onChange={(event) => void setState(event.target.value as TrackerIssue['state'])} className={`${fieldClass} py-1.5`}>
                      {(Object.keys(STATE_LABELS) as TrackerIssue['state'][]).map((value) => <option key={value} value={value}>{STATE_LABELS[value]}</option>)}
                    </select>
                  ) : <p className="text-sm text-text-secondary">{STATE_LABELS[issue.state]}</p>}
                </section>
                <section className="border-b border-border/60 pb-3">
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Priority</h4>
                  {canEdit ? (
                    <select value={issue.priority ?? 'normal'} disabled={busy} onChange={(event) => void updateField({ priority: event.target.value })} className={`${fieldClass} py-1.5`}>
                      {(Object.keys(PRIORITY_LABELS) as TrackerIssue['priority'][]).map((value) => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}
                    </select>
                  ) : <p className={`text-sm ${PRIORITY_CLASSES[issue.priority ?? 'normal']}`}>{PRIORITY_LABELS[issue.priority ?? 'normal']}</p>}
                </section>
                <section className="border-b border-border/60 pb-3">
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Due date</h4>
                  {canEdit ? (
                    <input type="date" value={dueInputValue(issue.due_at)} disabled={busy} onChange={(event) => void updateField({ dueAt: dueFromInput(event.target.value) })} className={`${fieldClass} py-1.5`} />
                  ) : <p className="text-sm text-text-secondary">{issue.due_at ? new Date(issue.due_at * 1000).toLocaleDateString() : 'None'}</p>}
                </section>
                {perms.manage && (
                  <button
                    type="button"
                    onClick={() => void remove()}
                    className="flex items-center gap-2 rounded px-1 py-1 text-sm text-text-muted hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" /> Delete issue
                  </button>
                )}
              </ItemFields>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}
