/**
 * TrackerChannelView — a Tracker channel on mobile: issue list with state tabs,
 * search and filters, the New issue sheet, and the issue detail modal.
 * Behavior reference: CatRealm-Client/src/components/workitems/TrackerChannel.tsx.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { CalendarClock, ChevronDown, CircleCheck, CircleDot, MessageSquare, Plus, Search, SlidersHorizontal, Tag, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Sheet } from '../Sheet';
import { createApi } from '@/lib/api';
import {
  DEFAULT_TRACKER_FILTER, EMPTY_TRACKER, apiErrorMessage, useWorkItemStore, workItemPath, type TrackerFilter,
} from '@/stores/workItemStore';
import type { Channel, TrackerIssue, TrackerIssuePriority, WorkItemLabel, WorkItemUser } from '@/types';
import { ItemDetailModal } from './ItemDetailModal';
import { LabelManagerSheet } from './LabelManagerSheet';
import { BACKDROP_BAR_COLOR, WorkChannelBackdrop } from './WorkChannelBackdrop';
import {
  AvatarStack, LabelChips, LabelSelectList, MemberSelectList, OptionList, SectionHeading, StateIcon, usePriorityColor,
} from './shared';
import {
  TRACKER_PRIORITIES, WORK_ITEM_LIMITS, dueFromInput, dueInDays, dueInputValue, formatDueDate, isOverdue, relativeTime, toggleId,
  useMemberOptions, useSelfUserId, useWorkItemPermissions, userLabel, type WorkItemPermissions,
} from './workItemUtils';

type FilterPanel = 'state' | 'label' | 'assignee' | 'author';
const STATE_FILTERS: TrackerFilter['state'][] = ['active', 'open', 'in_progress', 'blocked', 'closed', 'all'];

interface Props {
  channel: Channel;
  serverUrl?: string | null;
}

export function TrackerChannelView({ channel, serverUrl }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const tracker = useWorkItemStore((s) => s.trackers[channel.id] ?? EMPTY_TRACKER);
  const fetchIssues = useWorkItemStore((s) => s.fetchIssues);
  const fetchLabels = useWorkItemStore((s) => s.fetchLabels);
  const setTrackerFilter = useWorkItemStore((s) => s.setTrackerFilter);
  const perms = useWorkItemPermissions('tracker', channel);
  const selfId = useSelfUserId();
  const members = useMemberOptions();
  const { filter, issues, counts, labels, refreshNonce, settings } = tracker;

  const [search, setSearch] = useState(filter.q);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // A new issue opens once the create sheet has closed, so the two modals never stack.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterPanel, setFilterPanel] = useState<FilterPanel | null>(null);
  const [managingLabels, setManagingLabels] = useState(false);

  useEffect(() => { void fetchLabels('tracker', channel.id); }, [channel.id, fetchLabels]);
  useEffect(() => { void fetchIssues(channel.id); }, [channel.id, filter, refreshNonce, fetchIssues]);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    if (search === filter.q) return;
    const timer = setTimeout(() => setTrackerFilter(channel.id, { q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, filter.q, channel.id, setTrackerFilter]);

  const setFilter = useCallback((patch: Partial<TrackerFilter>) => setTrackerFilter(channel.id, patch), [channel.id, setTrackerFilter]);
  const activeCount = counts.open + (counts.in_progress ?? 0) + (counts.blocked ?? 0);
  const extraFilters = [filter.label, filter.assignee, filter.author].filter(Boolean).length
    + (['active', 'closed'].includes(filter.state) ? 0 : 1);
  const filtered = extraFilters > 0 || !!filter.q.trim();

  const openIssue = useCallback((id: string) => setOpenIssueId(id), []);
  const renderItem = useCallback(({ item }: { item: TrackerIssue }) => (
    <IssueRow issue={item} labels={labels} serverUrl={serverUrl} onOpen={openIssue} />
  ), [labels, serverUrl, openIssue]);

  // Over a background the tabs use the brighter secondary text, as desktop does.
  const mutedText = settings.background ? theme.colors.text2 : theme.colors.text3;
  const stateTab = (state: 'active' | 'closed', label: string, count: number) => {
    const on = filter.state === state;
    const Icon = state === 'active' ? CircleDot : CircleCheck;
    return (
      <Pressable haptic onPress={() => setFilter({ state })} accessibilityRole="tab" accessibilityState={{ selected: on }}
        style={[styles.tab, on && { backgroundColor: theme.colors.accentSoft }]}>
        <Icon size={14} color={on ? theme.colors.accent : mutedText} />
        <Text variant="bodySmall" color={on ? theme.colors.text : mutedText} style={on ? { fontWeight: '700' } : undefined}>
          {count} {label}
        </Text>
      </Pressable>
    );
  };

  const empty = () => {
    if (tracker.error) return <Text variant="bodySmall" color={theme.colors.danger} style={styles.emptyText}>{tracker.error}</Text>;
    if (!tracker.loaded) return <View style={styles.empty}><ActivityIndicator color={theme.colors.accent} /></View>;
    return (
      <View style={styles.empty}>
        <CircleDot size={30} color={theme.colors.text3} />
        <Text variant="subtitle" style={{ textAlign: 'center' }}>
          {filtered ? t('work.noIssuesMatch') : filter.state === 'closed' ? t('work.noClosedIssues') : t('work.noActiveIssues')}
        </Text>
        {!filtered && filter.state === 'active' && perms.create ? (
          <Text variant="bodySmall" color={theme.colors.text3} style={{ textAlign: 'center' }}>{t('work.createIssueHint')}</Text>
        ) : null}
      </View>
    );
  };

  const memberName = (id: string) => userLabel(members.find((m) => m.id === id) ?? null, t('work.formerMember'));
  const stateFilterLabel = (state: TrackerFilter['state']) => (
    state === 'active' ? t('work.allActive') : state === 'all' ? t('work.allIssues') : t(`work.state.${state}`)
  );

  const hasBackground = !!settings.background;

  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <WorkChannelBackdrop background={settings.background} serverUrl={serverUrl} />
      {/* With a background, the controls sit on a translucent bar so they stay readable. */}
      <View style={hasBackground ? { backgroundColor: BACKDROP_BAR_COLOR } : undefined}>
      {settings.title && settings.title !== channel.name ? (
        <Text variant="subtitle" numberOfLines={1} style={styles.boardTitle}>{settings.title}</Text>
      ) : null}
      <View style={styles.toolbar}>
        <View style={[styles.searchBox, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}>
          <Search size={15} color={theme.colors.text3} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('work.searchIssues')}
            placeholderTextColor={theme.colors.text3}
            style={[styles.searchInput, { color: theme.colors.text }]}
            returnKeyType="search"
          />
        </View>
        {perms.manage ? (
          <Pressable haptic onPress={() => setManagingLabels(true)} accessibilityRole="button" accessibilityLabel={t('work.labelsTitle')}
            style={[styles.iconBtn, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}>
            <Tag size={16} color={theme.colors.text2} />
          </Pressable>
        ) : null}
        {perms.create ? (
          <Pressable haptic onPress={() => setCreating(true)} accessibilityRole="button"
            style={[styles.newBtn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md }]}>
            <Plus size={16} color={theme.colors.textOnAccent} />
            <Text variant="subtitle" color={theme.colors.textOnAccent} style={{ fontSize: 14 }}>{t('work.newIssue')}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.tabRow}>
        {stateTab('active', t('work.active'), activeCount)}
        {stateTab('closed', t('work.closed'), counts.closed)}
        <View style={{ flex: 1 }} />
        {filtered ? (
          <Pressable haptic onPress={() => { setSearch(''); setFilter(DEFAULT_TRACKER_FILTER); }} style={styles.clearBtn}
            accessibilityRole="button" accessibilityLabel={t('work.clearFilters')}>
            <X size={14} color={theme.colors.text3} />
          </Pressable>
        ) : null}
        <Pressable haptic onPress={() => { setFilterPanel(null); setFiltersOpen(true); }} accessibilityRole="button"
          style={[styles.filterPill, { borderColor: extraFilters ? theme.colors.accent : theme.colors.line, backgroundColor: theme.colors.bgElev1 }]}>
          <SlidersHorizontal size={13} color={extraFilters ? theme.colors.accent : theme.colors.text3} />
          <Text variant="bodySmall" color={extraFilters ? theme.colors.accent : theme.colors.text3}>
            {extraFilters ? t('work.filtersCount', { count: extraFilters }) : t('work.filters')}
          </Text>
          <ChevronDown size={12} color={extraFilters ? theme.colors.accent : theme.colors.text3} />
        </Pressable>
      </View>
      </View>

      <FlatList
        data={issues}
        keyExtractor={(issue) => issue.id}
        renderItem={renderItem}
        windowSize={5}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: hasBackground ? 10 : 0, paddingBottom: 24, gap: 8 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={false}
        onRefresh={() => { void fetchIssues(channel.id); void fetchLabels('tracker', channel.id); }}
        onEndReached={() => { if (tracker.hasMore && !tracker.loading) void fetchIssues(channel.id, { append: true }); }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={empty()}
        ListFooterComponent={tracker.hasMore && tracker.loading ? <ActivityIndicator color={theme.colors.accent} style={{ marginVertical: 12 }} /> : null}
      />

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} maxHeightFraction={0.8} maxWidth={480}>
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
          {(['state', 'label', 'assignee', 'author'] as FilterPanel[]).map((panel) => {
            const summary = panel === 'state'
              ? stateFilterLabel(filter.state)
              : panel === 'label'
                ? (labels.find((l) => l.id === filter.label)?.name ?? t('work.any'))
                : panel === 'assignee'
                  ? (filter.assignee ? memberName(filter.assignee) : t('work.any'))
                  : (filter.author ? memberName(filter.author) : t('work.any'));
            const title = t(`work.filter.${panel}`);
            return (
              <View key={panel} style={[styles.filterSection, { borderBottomColor: theme.colors.lineSoft }]}>
                <Pressable haptic onPress={() => setFilterPanel((current) => (current === panel ? null : panel))} style={styles.filterHeader}>
                  <Text variant="body" style={{ flex: 1, fontWeight: '600' }}>{title}</Text>
                  <Text variant="bodySmall" color={theme.colors.text3} numberOfLines={1} style={{ maxWidth: '50%' }}>{summary}</Text>
                  <ChevronDown size={14} color={theme.colors.text3} style={filterPanel === panel ? { transform: [{ rotate: '180deg' }] } : undefined} />
                </Pressable>
                {filterPanel === panel ? (
                  panel === 'state' ? (
                    <OptionList<TrackerFilter['state']>
                      options={STATE_FILTERS.map((value) => ({ value, label: stateFilterLabel(value) }))}
                      value={filter.state}
                      renderLeft={(value) => (value === 'active' || value === 'all' ? <CircleDot size={15} color={theme.colors.text3} /> : <StateIcon state={value} size={15} />)}
                      onSelect={(value) => { setFilter({ state: value }); setFilterPanel(null); }}
                    />
                  ) : panel === 'label' ? (
                    <LabelSelectList
                      labels={labels}
                      selected={filter.label ? [filter.label] : []}
                      onToggle={(id) => { setFilter({ label: filter.label === id ? '' : id }); setFilterPanel(null); }}
                    />
                  ) : (
                    <MemberSelectList
                      members={members}
                      serverUrl={serverUrl}
                      selected={filter[panel] ? [filter[panel]] : []}
                      onToggle={(id) => { setFilter({ [panel]: filter[panel] === id ? '' : id }); setFilterPanel(null); }}
                    />
                  )
                ) : null}
              </View>
            );
          })}
          {filtered ? (
            <Pressable haptic onPress={() => { setSearch(''); setFilter(DEFAULT_TRACKER_FILTER); setFiltersOpen(false); }} style={styles.sheetAction}>
              <X size={16} color={theme.colors.text2} />
              <Text variant="body">{t('work.clearFilters')}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </Sheet>

      <LabelManagerSheet kind="tracker" channelId={channel.id} labels={labels} open={managingLabels} onClose={() => setManagingLabels(false)} />

      <NewIssueSheet
        channel={channel}
        labels={labels}
        perms={perms}
        members={members}
        serverUrl={serverUrl}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(issue) => { setPendingOpenId(issue.id); setCreating(false); }}
        onClosed={() => {
          if (!pendingOpenId) return;
          setOpenIssueId(pendingOpenId);
          setPendingOpenId(null);
        }}
      />

      {openIssueId ? (
        <ItemDetailModal
          kind="tracker"
          channel={channel}
          itemId={openIssueId}
          fallback={issues.find((issue) => issue.id === openIssueId)}
          labels={labels}
          perms={perms}
          selfId={selfId}
          serverUrl={serverUrl}
          onClose={() => setOpenIssueId(null)}
        />
      ) : null}
    </View>
  );
}

const IssueRow = memo(function IssueRow({ issue, labels, serverUrl, onOpen }: {
  issue: TrackerIssue;
  labels: WorkItemLabel[];
  serverUrl?: string | null;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const priorityColor = usePriorityColor();
  const overdue = isOverdue(issue.due_at, issue.state === 'closed');
  return (
    <Pressable
      haptic
      onPress={() => onOpen(issue.id)}
      style={[styles.row, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.lg }]}
      accessibilityRole="button"
    >
      <View style={{ paddingTop: 2 }}><StateIcon state={issue.state} size={17} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text variant="subtitle" style={styles.rowTitle}>{issue.title}</Text>
        <View style={styles.rowMeta}>
          {issue.priority && issue.priority !== 'normal' ? (
            <Text variant="caption" color={priorityColor(issue.priority)} style={{ fontWeight: '700' }}>{t(`work.priority.${issue.priority}`)}</Text>
          ) : null}
          <LabelChips labelIds={issue.label_ids} labels={labels} compact />
        </View>
        <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>
          {issue.state === 'closed' && issue.closed_at
            ? t('work.closedLine', { number: issue.number, time: relativeTime(issue.closed_at) })
            : t('work.openedLine', { number: issue.number, time: relativeTime(issue.created_at), name: userLabel(issue.author, t('work.deletedUser')) })}
        </Text>
        {issue.due_at ? (
          <View style={styles.inlineRow}>
            <CalendarClock size={13} color={overdue ? theme.colors.danger : theme.colors.text3} />
            <Text variant="caption" color={overdue ? theme.colors.danger : theme.colors.text3}>{t('work.due', { date: formatDueDate(issue.due_at) })}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.rowSide}>
        <AvatarStack users={issue.assignees} size={20} serverUrl={serverUrl} />
        {issue.comment_count > 0 ? (
          <View style={styles.inlineRow}>
            <MessageSquare size={13} color={theme.colors.text3} />
            <Text variant="caption" color={theme.colors.text3}>{issue.comment_count}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

function NewIssueSheet({ channel, labels, perms, members, serverUrl, open, onClose, onCreated, onClosed }: {
  channel: Channel;
  labels: WorkItemLabel[];
  perms: WorkItemPermissions;
  members: WorkItemUser[];
  serverUrl?: string | null;
  open: boolean;
  onClose: () => void;
  onCreated: (issue: TrackerIssue) => void;
  onClosed: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<TrackerIssuePriority>('normal');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueText, setDueText] = useState('');
  const [panel, setPanel] = useState<'priority' | 'labels' | 'assignees' | 'due' | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) return;
    setTitle(''); setBody(''); setPriority('normal'); setLabelIds([]); setAssigneeIds([]); setDueText(''); setPanel(null); setError('');
  }, [open]);

  const selectedAssignees = useMemo(() => members.filter((m) => assigneeIds.includes(m.id)), [members, assigneeIds]);

  const submit = async () => {
    if (!title.trim() || saving) return;
    const dueAt = dueFromInput(dueText);
    if (dueAt === undefined) { setError(t('work.invalidDate')); return; }
    setSaving(true);
    try {
      const res = await createApi().post<TrackerIssue>(workItemPath('tracker', channel.id), {
        title: title.trim(),
        body: body.trim(),
        priority,
        dueAt,
        ...(labelIds.length ? { labelIds } : {}),
        ...(assigneeIds.length && perms.assign ? { assigneeIds } : {}),
      });
      useWorkItemStore.getState().applyIssue(res.data, true);
      onCreated(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, t('work.createIssueFailed')));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.md }];
  const chip = (key: typeof panel & string, label: string) => (
    <Pressable key={key} haptic onPress={() => setPanel((current) => (current === key ? null : key))}
      style={[styles.chipBtn, { borderColor: panel === key ? theme.colors.accent : theme.colors.line }]}>
      <Text variant="bodySmall" color={panel === key ? theme.colors.accent : theme.colors.text2}>{label}</Text>
    </Pressable>
  );
  const canSubmit = !!title.trim() && !saving;

  return (
    <Sheet open={open} onClose={saving ? () => {} : onClose} onClosed={onClosed} maxHeightFraction={0.92} avoidKeyboard maxWidth={560}>
      <View style={styles.sheetHeader}>
        <Text variant="title" style={{ flex: 1 }}>{t('work.newIssue')}</Text>
        <Pressable haptic onPress={() => void submit()} disabled={!canSubmit}
          style={[styles.primaryBtn, { backgroundColor: theme.colors.accent, opacity: canSubmit ? 1 : 0.5 }]}>
          {saving
            ? <ActivityIndicator size="small" color={theme.colors.textOnAccent} />
            : <Text variant="subtitle" color={theme.colors.textOnAccent}>{t('work.create')}</Text>}
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t('work.titlePlaceholder')}
          placeholderTextColor={theme.colors.text3}
          maxLength={WORK_ITEM_LIMITS.title}
          style={[inputStyle, { fontWeight: '600' }]}
          editable={!saving}
          autoFocus
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t('work.describeIssue')}
          placeholderTextColor={theme.colors.text3}
          maxLength={WORK_ITEM_LIMITS.body}
          multiline
          textAlignVertical="top"
          style={[inputStyle, styles.bodyInput]}
          editable={!saving}
        />
        <View style={styles.chipRow}>
          {chip('priority', `${t('work.fields.priority')}: ${t(`work.priority.${priority}`)}`)}
          {chip('labels', labelIds.length ? `${t('work.fields.labels')} (${labelIds.length})` : t('work.fields.labels'))}
          {perms.assign ? chip('assignees', assigneeIds.length ? `${t('work.fields.assignees')} (${assigneeIds.length})` : t('work.fields.assignees')) : null}
          {chip('due', dueText.trim() ? `${t('work.fields.dueDate')}: ${dueText.trim()}` : t('work.fields.dueDate'))}
        </View>
        {labelIds.length ? <LabelChips labelIds={labelIds} labels={labels} /> : null}
        {selectedAssignees.length ? <AvatarStack users={selectedAssignees} serverUrl={serverUrl} max={6} /> : null}
        {panel === 'priority' ? (
          <OptionList<TrackerIssuePriority>
            options={TRACKER_PRIORITIES.map((value) => ({ value, label: t(`work.priority.${value}`) }))}
            value={priority}
            onSelect={(value) => { setPriority(value); setPanel(null); }}
          />
        ) : null}
        {panel === 'labels' ? (
          <LabelSelectList labels={labels} selected={labelIds} onToggle={(id) => setLabelIds((ids) => toggleId(ids, id))} />
        ) : null}
        {panel === 'assignees' ? (
          <MemberSelectList members={members} serverUrl={serverUrl} selected={assigneeIds} onToggle={(id) => setAssigneeIds((ids) => toggleId(ids, id))} />
        ) : null}
        {panel === 'due' ? (
          <View style={{ gap: 8 }}>
            <SectionHeading title={t('work.fields.dueDate')} />
            <View style={styles.chipRow}>
              {[
                { key: 'today', label: t('work.dueToday'), days: 0 },
                { key: 'tomorrow', label: t('work.dueTomorrow'), days: 1 },
                { key: 'week', label: t('work.dueNextWeek'), days: 7 },
              ].map((preset) => (
                <Pressable key={preset.key} haptic onPress={() => { setDueText(dueInputValue(dueInDays(preset.days))); setPanel(null); }}
                  style={[styles.chipBtn, { borderColor: theme.colors.line }]}>
                  <Text variant="bodySmall">{preset.label}</Text>
                </Pressable>
              ))}
              {dueText ? (
                <Pressable haptic onPress={() => setDueText('')} style={[styles.chipBtn, { borderColor: theme.colors.line }]}>
                  <Text variant="bodySmall" color={theme.colors.danger}>{t('common.clear')}</Text>
                </Pressable>
              ) : null}
            </View>
            <TextInput
              value={dueText}
              onChangeText={setDueText}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.colors.text3}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              style={inputStyle}
            />
          </View>
        ) : null}
        {error ? <Text variant="bodySmall" color={theme.colors.danger}>{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  boardTitle: { paddingHorizontal: 12, paddingTop: 12 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 40, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 40 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 34, borderRadius: 999 },
  clearBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  filterPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 34, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: 15, lineHeight: 20 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  rowSide: { alignItems: 'flex-end', gap: 8 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 16 },
  emptyText: { textAlign: 'center', paddingVertical: 32, paddingHorizontal: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  primaryBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, minWidth: 72, alignItems: 'center' },
  input: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  bodyInput: { minHeight: 120, maxHeight: 240 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipBtn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  filterSection: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 6 },
  filterHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  sheetAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10, minHeight: 48 },
});
