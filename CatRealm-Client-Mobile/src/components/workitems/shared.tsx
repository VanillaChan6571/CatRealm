/**
 * Building blocks shared by the Tracker and Board channel views.
 */

import { memo, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Check, CircleAlert, CircleCheck, CircleDot, CirclePause, Search } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Avatar } from '../Avatar';
import { Pressable } from '../Pressable';
import type { TrackerIssuePriority, TrackerIssueState, WorkItemLabel, WorkItemUser } from '@/types';
import { userLabel } from './workItemUtils';

export const IN_PROGRESS_COLOR = '#38BDF8';

export function useStateColor() {
  const theme = useTheme();
  return (state: TrackerIssueState) => {
    switch (state) {
      case 'in_progress': return IN_PROGRESS_COLOR;
      case 'blocked': return theme.colors.warning;
      case 'closed': return theme.colors.accent;
      default: return theme.colors.statusColor.online;
    }
  };
}

export function usePriorityColor() {
  const theme = useTheme();
  return (priority: TrackerIssuePriority) => {
    switch (priority) {
      case 'urgent': return theme.colors.danger;
      case 'high': return theme.colors.warning;
      case 'low': return theme.colors.text3;
      default: return theme.colors.text2;
    }
  };
}

export function StateIcon({ state, size = 16, color }: { state: TrackerIssueState; size?: number; color?: string }) {
  const stateColor = useStateColor();
  const c = color ?? stateColor(state);
  switch (state) {
    case 'in_progress': return <CirclePause size={size} color={c} />;
    case 'blocked': return <CircleAlert size={size} color={c} />;
    case 'closed': return <CircleCheck size={size} color={c} />;
    default: return <CircleDot size={size} color={c} />;
  }
}

export function UserAvatar({ user, size = 20, serverUrl }: { user: WorkItemUser | null; size?: number; serverUrl?: string | null }) {
  return (
    <Avatar
      username={userLabel(user)}
      uri={user?.avatar ?? null}
      baseUrl={serverUrl ?? undefined}
      accountType={user?.account_type ?? null}
      size={size}
      showStatus={false}
    />
  );
}

export function AvatarStack({ users, size = 20, max = 3, serverUrl }: { users: WorkItemUser[]; size?: number; max?: number; serverUrl?: string | null }) {
  const theme = useTheme();
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  return (
    <View style={styles.stack}>
      {shown.map((user, index) => (
        <View
          key={user.id}
          style={[styles.stackItem, { marginLeft: index === 0 ? 0 : -size * 0.3, borderColor: theme.colors.bgElev1, borderRadius: size }]}
        >
          <UserAvatar user={user} size={size} serverUrl={serverUrl} />
        </View>
      ))}
      {users.length > max ? (
        <Text variant="caption" color={theme.colors.text3} style={{ marginLeft: 4 }}>+{users.length - max}</Text>
      ) : null}
    </View>
  );
}

export function LabelChip({ label, compact = false }: { label: WorkItemLabel; compact?: boolean }) {
  return (
    <View
      style={[
        styles.chip,
        compact ? styles.chipCompact : null,
        { borderColor: `${label.color}66`, backgroundColor: `${label.color}26` },
      ]}
    >
      <Text numberOfLines={1} style={[styles.chipText, compact ? { fontSize: 10 } : null, { color: label.color }]}>{label.name}</Text>
    </View>
  );
}

export function LabelChips({ labelIds, labels, compact }: { labelIds: string[]; labels: WorkItemLabel[]; compact?: boolean }) {
  const shown = labels.filter((label) => labelIds.includes(label.id));
  if (shown.length === 0) return null;
  return (
    <View style={styles.chips}>
      {shown.map((label) => <LabelChip key={label.id} label={label} compact={compact} />)}
    </View>
  );
}

/** Small uppercase heading with an optional action on the right. */
export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeading}>
      <Text variant="caption" color={theme.colors.text3} style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

const SelectRow = memo(function SelectRow({ selected, onPress, children }: { selected: boolean; onPress: () => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Pressable
      haptic
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={[styles.selectRow, selected && { backgroundColor: theme.colors.accentSoft }]}
    >
      <View style={styles.selectCheck}>{selected ? <Check size={16} color={theme.colors.accent} /> : null}</View>
      {children}
    </Pressable>
  );
});

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}>
      <Search size={14} color={theme.colors.text3} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.text3}
        style={[styles.searchInput, { color: theme.colors.text }]}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

/** Selectable list of the channel's labels (rendered inline, not as a popover). */
export function LabelSelectList({ labels, selected, onToggle }: {
  labels: WorkItemLabel[];
  selected: string[];
  onToggle: (labelId: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const visible = q ? labels.filter((label) => label.name.toLowerCase().includes(q)) : labels;
  return (
    <View>
      {labels.length > 6 ? <SearchField value={query} onChange={setQuery} placeholder={t('work.filterLabels')} /> : null}
      {visible.map((label) => (
        <SelectRow key={label.id} selected={selected.includes(label.id)} onPress={() => onToggle(label.id)}>
          <View style={[styles.dot, { backgroundColor: label.color }]} />
          <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>{label.name}</Text>
        </SelectRow>
      ))}
      {visible.length === 0 ? (
        <Text variant="bodySmall" color={theme.colors.text3} style={styles.emptyRow}>
          {labels.length === 0 ? t('work.noLabelsYet') : t('work.noMatchingLabels')}
        </Text>
      ) : null}
    </View>
  );
}

export function MemberSelectList({ members, selected, onToggle, serverUrl }: {
  members: WorkItemUser[];
  selected: string[];
  onToggle: (userId: string) => void;
  serverUrl?: string | null;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? members.filter((member) => member.username.toLowerCase().includes(q) || (member.display_name ?? '').toLowerCase().includes(q))
      : members;
    // Selected people first so they can be removed without searching.
    return [...matches.filter((m) => selected.includes(m.id)), ...matches.filter((m) => !selected.includes(m.id))].slice(0, 50);
  }, [members, query, selected]);
  return (
    <View>
      <SearchField value={query} onChange={setQuery} placeholder={t('work.findMember')} />
      {visible.map((member) => (
        <SelectRow key={member.id} selected={selected.includes(member.id)} onPress={() => onToggle(member.id)}>
          <UserAvatar user={member} size={22} serverUrl={serverUrl} />
          <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>{userLabel(member)}</Text>
        </SelectRow>
      ))}
      {visible.length === 0 ? (
        <Text variant="bodySmall" color={theme.colors.text3} style={styles.emptyRow}>{t('work.noMembersFound')}</Text>
      ) : null}
    </View>
  );
}

/** Single-choice option rows (status, priority, filters). */
export function OptionList<T extends string>({ options, value, onSelect, renderLeft }: {
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onSelect: (value: T) => void;
  renderLeft?: (value: T) => ReactNode;
}) {
  return (
    <View>
      {options.map((option) => (
        <SelectRow key={option.value} selected={value === option.value} onPress={() => onSelect(option.value)}>
          {renderLeft ? renderLeft(option.value) : null}
          <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>{option.label}</Text>
        </SelectRow>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { flexDirection: 'row', alignItems: 'center' },
  stackItem: { borderWidth: 2, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: { maxWidth: 160, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 2 },
  chipCompact: { paddingHorizontal: 6, paddingVertical: 1 },
  chipText: { fontSize: 12, fontWeight: '600' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28, marginBottom: 4 },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: '600' },
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10, minHeight: 44, paddingHorizontal: 12, borderRadius: 8 },
  selectCheck: { width: 18, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 38, borderWidth: StyleSheet.hairlineWidth, marginBottom: 6 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  emptyRow: { textAlign: 'center', paddingVertical: 12 },
});
