/**
 * ItemDetailModal — one Tracker issue or Board card: title, description, fields,
 * attachments, the comment + activity timeline and the comment box.
 *
 * Behavior reference: CatRealm-Client/src/components/workitems/ItemDetail.tsx,
 * TrackerChannel.tsx (IssueView) and BoardChannel.tsx (CardModal). Pickers are
 * inline sections rather than nested sheets so nothing stacks on the modal.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import {
  Archive, ArchiveRestore, Bell, BellOff, CalendarClock, ChevronDown, ChevronUp, CircleCheck, CircleDot, Paperclip, Pencil, Send, Trash2, X,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { MarkdownText } from '../MarkdownText';
import { createApi } from '@/lib/api';
import { appendFormDataFile } from '@/lib/formData';
import {
  apiErrorMessage, useWorkItemStore, workItemPath, type WorkItem, type WorkKind,
} from '@/stores/workItemStore';
import type {
  BoardCard, BoardList, Channel, TrackerIssue, TrackerIssuePriority, TrackerIssueState, WorkItemComment, WorkItemEvent, WorkItemLabel, WorkItemUser,
} from '@/types';
import {
  LabelChips, LabelSelectList, MemberSelectList, OptionList, SectionHeading, StateIcon, UserAvatar, usePriorityColor, useStateColor,
} from './shared';
import {
  TRACKER_PRIORITIES, TRACKER_STATES, WORK_ITEM_LIMITS, dueFromInput, dueInDays, dueInputValue, formatDueDate, isOverdue, patchItem,
  relativeTime, resolveRealmUrl, setItemAssignees, toggleId, useMemberOptions, userLabel, type WorkItemPermissions,
} from './workItemUtils';

const EMPTY_LISTS: BoardList[] = [];
// Mirrors the realm server (routes/tracker.js).
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

type Editing = 'title' | 'body' | 'state' | 'priority' | 'due' | 'list' | 'assignees' | 'labels' | null;

interface Props {
  kind: WorkKind;
  channel: Channel;
  itemId: string;
  /** The list view's copy, shown until the detail request returns. */
  fallback?: WorkItem;
  labels: WorkItemLabel[];
  perms: WorkItemPermissions;
  selfId: string | null;
  serverUrl?: string | null;
  onClose: () => void;
  /** Board only: move the card to another list. */
  onMoveToList?: (card: BoardCard, listId: string) => void;
}

export function ItemDetailModal(props: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={props.onClose}
    >
      <View style={{ flex: 1, backgroundColor: theme.colors.bgApp, paddingTop: Platform.OS === 'ios' ? 0 : insets.top }}>
        <ItemDetailBody {...props} bottomInset={insets.bottom} />
      </View>
    </Modal>
  );
}

function ItemDetailBody({
  kind, channel, itemId, fallback, labels, perms, selfId, serverUrl, onClose, onMoveToList, bottomInset,
}: Props & { bottomInset: number }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const stored = useWorkItemStore((s) => s.openItems[itemId]);
  const item = stored ?? fallback;
  const detail = useWorkItemStore((s) => s.details[itemId]);
  const fetchDetail = useWorkItemStore((s) => s.fetchDetail);
  const closeDetail = useWorkItemStore((s) => s.closeDetail);
  const lists = useWorkItemStore((s) => s.boards[channel.id]?.lists ?? EMPTY_LISTS);
  const members = useMemberOptions();
  const stateColor = useStateColor();
  const priorityColor = usePriorityColor();

  const [editing, setEditing] = useState<Editing>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [dueDraft, setDueDraft] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  const updatedAt = item?.updated_at;
  const listId = item && 'list_id' in item ? item.list_id : undefined;

  // Refetched whenever the item changes or moves so the activity timeline stays current.
  useEffect(() => {
    let cancelled = false;
    fetchDetail(kind, channel.id, itemId)
      .then(() => { if (!cancelled) setLoadError(''); })
      .catch((err) => { if (!cancelled) setLoadError(apiErrorMessage(err, t('work.loadFailed'))); });
    return () => { cancelled = true; };
  }, [kind, channel.id, itemId, updatedAt, listId, fetchDetail, t]);

  useEffect(() => () => closeDetail(itemId), [itemId, closeDetail]);

  const issue = kind === 'tracker' ? (item as TrackerIssue | undefined) : undefined;
  const card = kind === 'board' ? (item as BoardCard | undefined) : undefined;

  const userName = (id: string | null | undefined) => {
    if (!id) return t('work.someone');
    const known: WorkItemUser | undefined = members.find((member) => member.id === id)
      ?? item?.assignees.find((user) => user.id === id)
      ?? (item?.author?.id === id ? item.author : undefined);
    return known ? userLabel(known) : t('work.formerMember');
  };

  const run = async (action: () => Promise<unknown>, fallbackMessage = t('work.actionFailed')) => {
    setBusy(true);
    try {
      await action();
      setError('');
      return true;
    } catch (err) {
      setError(apiErrorMessage(err, fallbackMessage));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View style={[styles.header, { borderBottomColor: theme.colors.lineSoft }]}>
      <Pressable haptic onPress={onClose} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('common.close')}>
        <X size={20} color={theme.colors.text2} />
      </Pressable>
      <Text variant="subtitle" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
        {issue
          ? `#${issue.number}`
          : card
            ? (card.archived ? t('work.archivedCard') : t('work.cardInList', { list: lists.find((l) => l.id === card.list_id)?.name ?? t('work.deletedList') }))
            : ''}
      </Text>
      <View style={styles.headerBtn} />
    </View>
  );

  if (!item) {
    return (
      <>
        {header}
        <View style={styles.center}>
          {loadError
            ? <Text variant="bodySmall" color={theme.colors.danger} style={{ textAlign: 'center' }}>{`${loadError}. ${t('work.notFound')}`}</Text>
            : <ActivityIndicator color={theme.colors.accent} />}
        </View>
      </>
    );
  }

  const canEdit = perms.manage || (!!selfId && item.created_by === selfId);
  // Someone the issue is assigned to may move it along, even if they cannot edit it.
  const canSetState = canEdit || (!!selfId && item.assignees.some((user) => user.id === selfId));
  const toggleEditing = (target: Exclude<Editing, null>) => setEditing((current) => (current === target ? null : target));

  const saveTitle = async () => {
    const next = titleDraft.trim();
    if (!next || next === item.title) { setEditing(null); return; }
    if (await run(() => patchItem(kind, item, { title: next }))) setEditing(null);
  };
  const saveBody = async () => {
    if (await run(() => patchItem(kind, item, { body: bodyDraft.trim() }))) setEditing(null);
  };
  const setDue = async (dueAt: number | null) => {
    if (await run(() => patchItem(kind, item, { dueAt }))) setEditing(null);
  };
  const setState = (state: TrackerIssueState) => run(() => patchItem('tracker', item, { state }));

  // Posts the pending comment; resolves true when there was nothing to post or it was posted.
  const submitComment = async () => {
    const body = comment.trim();
    if (!body) return true;
    setPosting(true);
    try {
      const res = await createApi().post<WorkItemComment>(`${workItemPath(kind, item.channel_id, item.id)}/comments`, { body });
      useWorkItemStore.getState().applyComment(kind, item.channel_id, item.id, res.data);
      setComment('');
      setError('');
      return true;
    } catch (err) {
      setError(apiErrorMessage(err, t('work.commentFailed')));
      return false;
    } finally {
      setPosting(false);
    }
  };

  const toggleIssueClosed = async () => {
    if (!issue) return;
    if (!(await submitComment())) return;
    await setState(issue.state === 'closed' ? 'open' : 'closed');
  };

  const toggleWatch = () => run(async () => {
    const path = `${workItemPath('tracker', channel.id, item.id)}/watch`;
    if (detail?.watching) await createApi().delete(path);
    else await createApi().put(path);
    await fetchDetail('tracker', channel.id, item.id);
  });

  const confirmDelete = () => {
    const title = kind === 'tracker' ? t('work.deleteIssue') : t('work.deleteCard');
    const message = issue
      ? t('work.deleteIssueConfirm', { number: issue.number })
      : t('work.deleteCardConfirm', { title: item.title });
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void run(async () => {
            await createApi().delete(workItemPath(kind, channel.id, item.id));
            if (kind === 'tracker') useWorkItemStore.getState().removeIssue(channel.id, item.id);
            else useWorkItemStore.getState().removeCard(channel.id, item.id);
            onClose();
          });
        },
      },
    ]);
  };

  const removeAttachment = (id: string, name: string) => {
    Alert.alert(t('work.removeAttachment'), t('work.removeAttachmentConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => {
          void run(async () => {
            await createApi().delete(`${workItemPath('tracker', channel.id, item.id)}/attachments/${id}`);
            await fetchDetail('tracker', channel.id, item.id);
          });
        },
      },
    ]);
  };

  const uploadAttachments = async () => {
    const existing = detail?.attachments?.length ?? 0;
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' });
    } catch {
      return;
    }
    if (picked.canceled || !picked.assets?.length) return;
    if (existing + picked.assets.length > MAX_ATTACHMENTS) { setError(t('work.attachmentLimit', { count: MAX_ATTACHMENTS })); return; }
    const tooBig = picked.assets.find((asset) => (asset.size ?? 0) > MAX_ATTACHMENT_BYTES);
    if (tooBig) { setError(t('work.attachmentTooLarge', { name: tooBig.name })); return; }
    setUploading(true);
    try {
      // One request per file, like desktop; the server rejects types it does not accept.
      for (const asset of picked.assets) {
        const form = new FormData();
        appendFormDataFile(form, 'file', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' });
        await createApi().post(`${workItemPath('tracker', channel.id, item.id)}/attachments`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000,
        });
      }
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, t('work.uploadFailed')));
    } finally {
      try { await fetchDetail('tracker', channel.id, item.id); } catch { /* keep the upload error */ }
      setUploading(false);
    }
  };

  const assigneeIds = item.assignees.map((user) => user.id);
  // Assigned people who left the realm still need a row to be removable.
  const memberOptions = (() => {
    const known = new Set(members.map((member) => member.id));
    return [...item.assignees.filter((user) => !known.has(user.id)), ...members];
  })();

  const editLink = (target: Exclude<Editing, null>, onOpen?: () => void) => (
    <Pressable
      haptic
      onPress={() => { onOpen?.(); toggleEditing(target); }}
      style={styles.editLink}
      accessibilityRole="button"
    >
      <Text variant="bodySmall" color={theme.colors.accent}>{editing === target ? t('work.done') : t('work.edit')}</Text>
    </Pressable>
  );

  const fieldCard = { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.lg };
  const inputStyle = [styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.md }];

  const field = (title: string, value: ReactNode, target: Exclude<Editing, null> | null, editor: ReactNode, onOpen?: () => void) => (
    <View style={[styles.field, { borderBottomColor: theme.colors.lineSoft }]}>
      <SectionHeading title={title} action={target ? editLink(target, onOpen) : undefined} />
      {target && editing === target ? editor : value}
    </View>
  );

  const dueEditor = (
    <View style={{ gap: 8 }}>
      <View style={styles.presetRow}>
        {[
          { key: 'today', label: t('work.dueToday'), value: dueInDays(0) },
          { key: 'tomorrow', label: t('work.dueTomorrow'), value: dueInDays(1) },
          { key: 'week', label: t('work.dueNextWeek'), value: dueInDays(7) },
        ].map((preset) => (
          <Pressable key={preset.key} haptic disabled={busy} onPress={() => void setDue(preset.value)}
            style={[styles.preset, { borderColor: theme.colors.line }]}>
            <Text variant="bodySmall">{preset.label}</Text>
          </Pressable>
        ))}
        {item.due_at ? (
          <Pressable haptic disabled={busy} onPress={() => void setDue(null)} style={[styles.preset, { borderColor: theme.colors.line }]}>
            <Text variant="bodySmall" color={theme.colors.danger}>{t('common.clear')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.inlineRow}>
        <TextInput
          value={dueDraft}
          onChangeText={setDueDraft}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.colors.text3}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          style={[inputStyle, { flex: 1 }]}
          onSubmitEditing={() => {
            const parsed = dueFromInput(dueDraft);
            if (parsed === undefined) setError(t('work.invalidDate'));
            else void setDue(parsed);
          }}
        />
        <Pressable
          haptic
          disabled={busy}
          onPress={() => {
            const parsed = dueFromInput(dueDraft);
            if (parsed === undefined) setError(t('work.invalidDate'));
            else void setDue(parsed);
          }}
          style={[styles.smallBtn, { backgroundColor: theme.colors.accent }]}
        >
          <Text variant="bodySmall" color={theme.colors.textOnAccent}>{t('common.save')}</Text>
        </Pressable>
      </View>
    </View>
  );

  const dueValue = item.due_at ? (
    <View style={styles.inlineRow}>
      <CalendarClock size={15} color={isOverdue(item.due_at, issue?.state === 'closed') ? theme.colors.danger : theme.colors.text2} />
      <Text variant="body" color={isOverdue(item.due_at, issue?.state === 'closed') ? theme.colors.danger : theme.colors.text}>
        {formatDueDate(item.due_at)}
      </Text>
    </View>
  ) : <Text variant="bodySmall" color={theme.colors.text3}>{t('work.none')}</Text>;

  const attachments = detail?.attachments ?? [];

  return (
    <>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* Title */}
          {editing === 'title' ? (
            <View style={{ gap: 8 }}>
              <TextInput
                autoFocus
                value={titleDraft}
                onChangeText={setTitleDraft}
                maxLength={WORK_ITEM_LIMITS.title}
                style={[inputStyle, { fontSize: 17, fontWeight: '600' }]}
                returnKeyType="done"
                onSubmitEditing={() => void saveTitle()}
              />
              <View style={styles.actionsRight}>
                <Pressable haptic onPress={() => setEditing(null)} style={styles.smallBtnGhost}>
                  <Text variant="bodySmall" color={theme.colors.text2}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable haptic disabled={busy || !titleDraft.trim()} onPress={() => void saveTitle()}
                  style={[styles.smallBtn, { backgroundColor: theme.colors.accent, opacity: titleDraft.trim() ? 1 : 0.5 }]}>
                  <Text variant="bodySmall" color={theme.colors.textOnAccent}>{t('common.save')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              disabled={!canEdit}
              onLongPress={() => { setTitleDraft(item.title); setEditing('title'); }}
              onPress={() => { if (canEdit) { setTitleDraft(item.title); setEditing('title'); } }}
              style={styles.titleRow}
              accessibilityHint={canEdit ? t('work.tapToEdit') : undefined}
            >
              <Text variant="title" style={{ flex: 1 }}>{item.title}</Text>
              {canEdit ? <Pencil size={15} color={theme.colors.text3} style={{ marginTop: 6 }} /> : null}
            </Pressable>
          )}

          {/* Meta */}
          <View style={styles.metaRow}>
            {issue ? (
              <View style={[styles.stateBadge, { backgroundColor: stateColor(issue.state) }]}>
                <StateIcon state={issue.state} size={13} color="#fff" />
                <Text variant="caption" color="#fff" style={{ fontWeight: '700' }}>{t(`work.state.${issue.state}`)}</Text>
              </View>
            ) : null}
            {card?.archived ? (
              <View style={[styles.stateBadge, { backgroundColor: theme.colors.warning }]}>
                <Archive size={13} color="#fff" />
                <Text variant="caption" color="#fff" style={{ fontWeight: '700' }}>{t('work.archived')}</Text>
              </View>
            ) : null}
            <Text variant="caption" color={theme.colors.text3} style={{ flexShrink: 1 }}>
              {t('work.openedByLine', { name: userLabel(item.author, t('work.deletedUser')), time: relativeTime(item.created_at) })}
              {' · '}
              {t('work.comments', { count: item.comment_count })}
            </Text>
          </View>

          {/* Body */}
          <View style={[styles.bodyCard, fieldCard]}>
            {editing === 'body' ? (
              <View style={{ gap: 8 }}>
                <TextInput
                  autoFocus
                  value={bodyDraft}
                  onChangeText={setBodyDraft}
                  maxLength={WORK_ITEM_LIMITS.body}
                  placeholder={t('work.descriptionPlaceholder')}
                  placeholderTextColor={theme.colors.text3}
                  multiline
                  textAlignVertical="top"
                  style={[inputStyle, styles.multiline]}
                />
                <View style={styles.actionsRight}>
                  <Pressable haptic onPress={() => setEditing(null)} style={styles.smallBtnGhost}>
                    <Text variant="bodySmall" color={theme.colors.text2}>{t('common.cancel')}</Text>
                  </Pressable>
                  <Pressable haptic disabled={busy} onPress={() => void saveBody()} style={[styles.smallBtn, { backgroundColor: theme.colors.accent }]}>
                    <Text variant="bodySmall" color={theme.colors.textOnAccent}>{t('common.save')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.bodyHeader}>
                  <UserAvatar user={item.author} size={20} serverUrl={serverUrl} />
                  <Text variant="bodySmall" color={theme.colors.text2} style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>
                    {userLabel(item.author, t('work.deletedUser'))}
                  </Text>
                  {canEdit ? (
                    <Pressable haptic onPress={() => { setBodyDraft(item.body); setEditing('body'); }} style={styles.iconHit}
                      accessibilityRole="button" accessibilityLabel={t('work.editDescription')}>
                      <Pencil size={15} color={theme.colors.text3} />
                    </Pressable>
                  ) : null}
                </View>
                {item.body
                  ? <MarkdownText text={item.body} color={theme.colors.text} serverUrl={serverUrl} allowEmbeds={false} />
                  : <Text variant="bodySmall" color={theme.colors.text3} style={{ fontStyle: 'italic' }}>{t('work.noDescription')}</Text>}
              </>
            )}
          </View>

          {/* Fields */}
          <View style={[styles.fields, fieldCard]}>
            {issue ? field(
              t('work.fields.status'),
              <View style={styles.inlineRow}>
                <StateIcon state={issue.state} size={15} />
                <Text variant="body">{t(`work.state.${issue.state}`)}</Text>
              </View>,
              canSetState ? 'state' : null,
              <OptionList<TrackerIssueState>
                options={TRACKER_STATES.map((value) => ({ value, label: t(`work.state.${value}`) }))}
                value={issue.state}
                renderLeft={(value) => <StateIcon state={value} size={15} />}
                onSelect={(value) => { void setState(value).then((ok) => { if (ok) setEditing(null); }); }}
              />,
            ) : null}

            {issue ? field(
              t('work.fields.priority'),
              <Text variant="body" color={priorityColor(issue.priority ?? 'normal')}>{t(`work.priority.${issue.priority ?? 'normal'}`)}</Text>,
              canEdit ? 'priority' : null,
              <OptionList<TrackerIssuePriority>
                options={TRACKER_PRIORITIES.map((value) => ({ value, label: t(`work.priority.${value}`) }))}
                value={issue.priority ?? 'normal'}
                onSelect={(value) => { void run(() => patchItem('tracker', item, { priority: value })).then((ok) => { if (ok) setEditing(null); }); }}
              />,
            ) : null}

            {card && !card.archived && perms.create && lists.length > 1 && onMoveToList ? field(
              t('work.fields.list'),
              <Text variant="body">{lists.find((l) => l.id === card.list_id)?.name ?? t('work.deletedList')}</Text>,
              'list',
              <OptionList<string>
                options={lists.map((list) => ({ value: list.id, label: list.name }))}
                value={card.list_id}
                onSelect={(value) => { if (value !== card.list_id) onMoveToList(card, value); setEditing(null); }}
              />,
            ) : null}

            {field(t('work.fields.dueDate'), dueValue, canEdit ? 'due' : null, dueEditor, () => setDueDraft(dueInputValue(item.due_at)))}

            {field(
              t('work.fields.assignees'),
              item.assignees.length === 0
                ? <Text variant="bodySmall" color={theme.colors.text3}>{t('work.noAssignees')}</Text>
                : (
                  <View style={{ gap: 6 }}>
                    {item.assignees.map((user) => (
                      <View key={user.id} style={styles.inlineRow}>
                        <UserAvatar user={user} size={22} serverUrl={serverUrl} />
                        <Text variant="body" numberOfLines={1}>{userLabel(user)}</Text>
                      </View>
                    ))}
                  </View>
                ),
              perms.assign ? 'assignees' : null,
              <MemberSelectList
                members={memberOptions}
                selected={assigneeIds}
                serverUrl={serverUrl}
                onToggle={(id) => { void run(() => setItemAssignees(kind, item, toggleId(assigneeIds, id))); }}
              />,
            )}

            {field(
              t('work.fields.labels'),
              item.label_ids.length === 0
                ? <Text variant="bodySmall" color={theme.colors.text3}>{t('work.noLabels')}</Text>
                : <LabelChips labelIds={item.label_ids} labels={labels} />,
              canEdit ? 'labels' : null,
              <LabelSelectList
                labels={labels}
                selected={item.label_ids}
                onToggle={(id) => { void run(() => patchItem(kind, item, { labelIds: toggleId(item.label_ids, id) })); }}
              />,
            )}

            {issue ? (
              <View style={[styles.field, { borderBottomWidth: 0 }]}>
                <SectionHeading title={t('work.fields.watchers')} />
                <Pressable haptic disabled={busy || !detail} onPress={() => void toggleWatch()} style={[styles.inlineRow, { minHeight: 36, opacity: detail ? 1 : 0.5 }]}
                  accessibilityRole="button">
                  {detail?.watching ? <BellOff size={16} color={theme.colors.text2} /> : <Bell size={16} color={theme.colors.text2} />}
                  <Text variant="body">{detail?.watching ? t('work.unwatch') : t('work.watch')}</Text>
                  <Text variant="bodySmall" color={theme.colors.text3}>· {t('work.watcherCount', { count: detail?.watcher_count ?? 0 })}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* Attachments (tracker) */}
          {issue && (attachments.length > 0 || (perms.comment && perms.attach)) ? (
            <View style={{ gap: 6 }}>
              <SectionHeading
                title={t('work.attachmentsCount', { count: attachments.length })}
                action={perms.comment && perms.attach ? (
                  <Pressable haptic disabled={uploading || !detail} onPress={() => void uploadAttachments()}
                    style={[styles.attachBtn, { borderColor: theme.colors.line }]} accessibilityRole="button">
                    {uploading ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Paperclip size={14} color={theme.colors.text2} />}
                    <Text variant="bodySmall" color={theme.colors.text2}>{uploading ? t('work.uploading') : t('work.attachFiles')}</Text>
                  </Pressable>
                ) : undefined}
              />
              {attachments.map((attachment) => {
                const url = resolveRealmUrl(attachment.url, serverUrl);
                return (
                  <View key={attachment.id} style={[styles.attachment, fieldCard]}>
                    <Paperclip size={15} color={theme.colors.text3} />
                    <Pressable style={{ flex: 1, alignItems: 'flex-start' }} onPress={() => { if (url) void Linking.openURL(url); }} accessibilityRole="link">
                      <Text variant="bodySmall" color={theme.colors.accent} numberOfLines={1}>{attachment.name}</Text>
                    </Pressable>
                    <Text variant="caption" color={theme.colors.text3}>{Math.max(1, Math.ceil(attachment.size / 1024))} KB</Text>
                    {(perms.manage || attachment.uploaded_by === selfId) ? (
                      <Pressable haptic onPress={() => removeAttachment(attachment.id, attachment.name)} style={styles.iconHit}
                        accessibilityRole="button" accessibilityLabel={t('work.removeAttachment')}>
                        <X size={15} color={theme.colors.text3} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Timeline */}
          <View>
            <SectionHeading title={t('work.fields.activity')} />
            <Timeline
              kind={kind}
              item={item}
              detailLoaded={!!detail}
              comments={detail?.comments}
              events={detail?.events}
              labels={labels}
              lists={lists}
              selfId={selfId}
              canManage={perms.manage}
              serverUrl={serverUrl}
              userName={userName}
              onError={setError}
            />
          </View>

          {/* Card / issue actions */}
          {(card && canEdit) || perms.manage ? (
            <View style={[styles.fields, fieldCard]}>
              {card && canEdit ? (
                <Pressable haptic disabled={busy} onPress={() => void run(() => patchItem('board', card, { archived: !card.archived }))} style={styles.actionRow}>
                  {card.archived ? <ArchiveRestore size={17} color={theme.colors.text2} /> : <Archive size={17} color={theme.colors.text2} />}
                  <Text variant="body">{card.archived ? t('work.restoreCard') : t('work.archiveCard')}</Text>
                </Pressable>
              ) : null}
              {perms.manage ? (
                <Pressable haptic disabled={busy} onPress={confirmDelete} style={styles.actionRow}>
                  <Trash2 size={17} color={theme.colors.danger} />
                  <Text variant="body" color={theme.colors.danger}>{kind === 'tracker' ? t('work.deleteIssue') : t('work.deleteCard')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {error ? <Text variant="bodySmall" color={theme.colors.danger}>{error}</Text> : null}
        </ScrollView>

        {/* Comment box */}
        <View style={[styles.composer, { borderTopColor: theme.colors.lineSoft, paddingBottom: Math.max(bottomInset, 10), backgroundColor: theme.colors.bgApp }]}>
          {perms.comment ? (
            <View style={styles.inlineRow}>
              <TextInput
                value={comment}
                onChangeText={setComment}
                maxLength={WORK_ITEM_LIMITS.comment}
                placeholder={t('work.commentPlaceholder')}
                placeholderTextColor={theme.colors.text3}
                multiline
                style={[inputStyle, styles.commentInput]}
              />
              <Pressable
                haptic
                disabled={posting || !comment.trim()}
                onPress={() => void submitComment()}
                style={[styles.sendBtn, { backgroundColor: theme.colors.accent, opacity: comment.trim() ? 1 : 0.5 }]}
                accessibilityRole="button"
                accessibilityLabel={t('work.comment')}
              >
                {posting ? <ActivityIndicator size="small" color={theme.colors.textOnAccent} /> : <Send size={17} color={theme.colors.textOnAccent} />}
              </Pressable>
            </View>
          ) : (
            <Text variant="caption" color={theme.colors.text3} style={{ textAlign: 'center' }}>{t('work.noCommentPermission')}</Text>
          )}
          {issue && canSetState ? (
            <Pressable haptic disabled={busy || posting} onPress={() => void toggleIssueClosed()}
              style={[styles.closeBtn, { borderColor: theme.colors.line }]} accessibilityRole="button">
              {issue.state !== 'closed'
                ? <CircleCheck size={16} color={theme.colors.accent} />
                : <CircleDot size={16} color={theme.colors.statusColor.online} />}
              <Text variant="bodySmall" style={{ fontWeight: '600' }}>
                {issue.state !== 'closed'
                  ? (comment.trim() ? t('work.closeWithComment') : t('work.closeIssue'))
                  : (comment.trim() ? t('work.reopenWithComment') : t('work.reopenIssue'))}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

type TimelineEntry =
  | { kind: 'comment'; at: number; comment: WorkItemComment }
  | { kind: 'event'; at: number; event: WorkItemEvent };

function Timeline({
  kind, item, detailLoaded, comments, events, labels, lists, selfId, canManage, serverUrl, userName, onError,
}: {
  kind: WorkKind;
  item: WorkItem;
  detailLoaded: boolean;
  comments: WorkItemComment[] | undefined;
  events: WorkItemEvent[] | undefined;
  labels: WorkItemLabel[];
  lists: BoardList[];
  selfId: string | null;
  canManage: boolean;
  serverUrl?: string | null;
  userName: (id: string | null | undefined) => string;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [showAllEvents, setShowAllEvents] = useState(false);

  const entries = useMemo<TimelineEntry[]>(() => [
    ...(comments ?? []).map((comment) => ({ kind: 'comment' as const, at: comment.created_at, comment })),
    ...(events ?? []).map((event) => ({ kind: 'event' as const, at: event.created_at, event })),
  ].sort((a, b) => a.at - b.at), [comments, events]);

  if (!detailLoaded) {
    return <Text variant="bodySmall" color={theme.colors.text3}>{t('work.loadingActivity')}</Text>;
  }
  if (entries.length === 0) {
    return <Text variant="bodySmall" color={theme.colors.text3}>{t('work.noActivity')}</Text>;
  }

  // Long histories collapse their older events (never comments) behind one row.
  const COLLAPSE_AFTER = 12;
  let hiddenEvents = 0;
  const visible = showAllEvents || entries.length <= COLLAPSE_AFTER
    ? entries
    : entries.filter((entry, index) => {
      const keep = entry.kind === 'comment' || index >= entries.length - COLLAPSE_AFTER;
      if (!keep) hiddenEvents += 1;
      return keep;
    });

  return (
    <View style={{ gap: 2 }}>
      {hiddenEvents > 0 ? (
        <Pressable haptic onPress={() => setShowAllEvents(true)} style={[styles.inlineRow, { minHeight: 36 }]}>
          <ChevronDown size={14} color={theme.colors.text3} />
          <Text variant="caption" color={theme.colors.text3}>{t('work.showOlderEvents', { count: hiddenEvents })}</Text>
        </Pressable>
      ) : null}
      {showAllEvents && entries.length > COLLAPSE_AFTER ? (
        <Pressable haptic onPress={() => setShowAllEvents(false)} style={[styles.inlineRow, { minHeight: 36 }]}>
          <ChevronUp size={14} color={theme.colors.text3} />
          <Text variant="caption" color={theme.colors.text3}>{t('work.hideOlderEvents')}</Text>
        </Pressable>
      ) : null}
      {visible.map((entry) => (entry.kind === 'comment'
        ? (
          <CommentRow
            key={`c-${entry.comment.id}`}
            kind={kind}
            item={item}
            comment={entry.comment}
            selfId={selfId}
            canManage={canManage}
            serverUrl={serverUrl}
            onError={onError}
          />
        )
        : <EventRow key={`e-${entry.event.id}`} event={entry.event} labels={labels} lists={lists} userName={userName} />
      ))}
    </View>
  );
}

function EventRow({ event, labels, lists, userName }: {
  event: WorkItemEvent;
  labels: WorkItemLabel[];
  lists: BoardList[];
  userName: (id: string | null | undefined) => string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const labelNames = (ids: string[] | undefined) => (ids ?? [])
    .map((id) => labels.find((l) => l.id === id)?.name ?? t('work.deletedLabel')).join(', ');
  const names = (ids: string[] | undefined) => (ids ?? []).map((id) => userName(id)).join(', ');
  const listName = (id: string | number | null | undefined) => lists.find((list) => list.id === id)?.name ?? t('work.deletedList');
  const stateName = (value: string | number | null | undefined) => {
    const key = String(value ?? '');
    return (TRACKER_STATES as string[]).includes(key) ? t(`work.state.${key}`) : key;
  };
  const priorityName = (value: string | number | null | undefined) => {
    const key = String(value ?? '');
    return (TRACKER_PRIORITIES as string[]).includes(key) ? t(`work.priority.${key}`) : key;
  };
  const date = (value: string | number | null | undefined) => (typeof value === 'number' ? formatDueDate(value) : t('work.none'));
  const added = event.data?.added ?? [];
  const removed = event.data?.removed ?? [];

  let text = '';
  switch (event.type) {
    case 'renamed': text = t('work.event.renamed', { from: event.data?.from ?? '', to: event.data?.to ?? '' }); break;
    case 'closed': text = t('work.event.closed'); break;
    case 'reopened': text = t('work.event.reopened'); break;
    case 'archived': text = t('work.event.archived'); break;
    case 'restored': text = t('work.event.restored'); break;
    case 'moved': text = t('work.event.moved', { from: listName(event.data?.from), to: listName(event.data?.to) }); break;
    case 'state': text = t('work.event.state', { from: stateName(event.data?.from), to: stateName(event.data?.to) }); break;
    case 'priority': text = t('work.event.priority', { from: priorityName(event.data?.from), to: priorityName(event.data?.to) }); break;
    case 'due_date': text = t('work.event.dueDate', { from: date(event.data?.from), to: date(event.data?.to) }); break;
    case 'attachment_added': text = t('work.event.attachmentAdded', { name: event.data?.name ?? '' }); break;
    case 'attachment_removed': text = t('work.event.attachmentRemoved', { name: event.data?.name ?? '' }); break;
    case 'labels':
      text = [
        added.length ? t('work.event.labelsAdded', { labels: labelNames(added) }) : '',
        removed.length ? t('work.event.labelsRemoved', { labels: labelNames(removed) }) : '',
      ].filter(Boolean).join(', ');
      break;
    case 'assignees':
      text = [
        added.length ? t('work.event.assigned', { names: names(added) }) : '',
        removed.length ? t('work.event.unassigned', { names: names(removed) }) : '',
      ].filter(Boolean).join(', ');
      break;
    default: text = String(event.type);
  }
  return (
    <View style={styles.eventRow}>
      <View style={[styles.eventDot, { backgroundColor: theme.colors.bgElev2 }]} />
      <Text variant="caption" color={theme.colors.text3} style={{ flex: 1, lineHeight: 18 }}>
        <Text variant="caption" color={theme.colors.text2} style={{ fontWeight: '700' }}>{userName(event.actor_id)}</Text>
        {` ${text} · ${relativeTime(event.created_at)}`}
      </Text>
    </View>
  );
}

function CommentRow({ kind, item, comment, selfId, canManage, serverUrl, onError }: {
  kind: WorkKind;
  item: WorkItem;
  comment: WorkItemComment;
  selfId: string | null;
  canManage: boolean;
  serverUrl?: string | null;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const isAuthor = !!selfId && comment.user_id === selfId;
  const path = `${workItemPath(kind, item.channel_id, item.id)}/comments/${comment.id}`;

  const save = async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      const res = await createApi().patch<WorkItemComment>(path, { body });
      useWorkItemStore.getState().applyComment(kind, item.channel_id, item.id, res.data);
      setEditing(false);
      onError('');
    } catch (err) {
      onError(apiErrorMessage(err, t('work.actionFailed')));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert(t('work.deleteComment'), t('work.deleteCommentConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          createApi().delete(path)
            .then(() => useWorkItemStore.getState().removeComment(kind, item.channel_id, item.id, comment.id))
            .catch((err) => onError(apiErrorMessage(err, t('work.actionFailed'))));
        },
      },
    ]);
  };

  const openMenu = () => {
    if (!isAuthor && !canManage) return;
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (isAuthor) buttons.push({ text: t('work.editComment'), onPress: () => { setDraft(comment.body); setEditing(true); } });
    buttons.push({ text: t('work.deleteComment'), style: 'destructive', onPress: remove });
    buttons.push({ text: t('common.cancel'), style: 'cancel' });
    Alert.alert(t('work.commentActions'), undefined, buttons);
  };

  return (
    <Pressable
      onLongPress={openMenu}
      delayLongPress={350}
      style={[styles.comment, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.lg }]}
    >
      <View style={styles.bodyHeader}>
        <UserAvatar user={comment.author} size={22} serverUrl={serverUrl} />
        <Text variant="bodySmall" style={{ fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
          {userLabel(comment.author, t('work.deletedUser'))}
        </Text>
        <Text variant="caption" color={theme.colors.text3}>
          {relativeTime(comment.created_at)}{comment.edited_at ? ` ${t('common.edited')}` : ''}
        </Text>
      </View>
      {editing ? (
        <View style={{ gap: 8 }}>
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            maxLength={WORK_ITEM_LIMITS.comment}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.multiline, { color: theme.colors.text, backgroundColor: theme.colors.bgApp, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}
          />
          <View style={styles.actionsRight}>
            <Pressable haptic onPress={() => setEditing(false)} style={styles.smallBtnGhost}>
              <Text variant="bodySmall" color={theme.colors.text2}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable haptic disabled={saving || !draft.trim()} onPress={() => void save()} style={[styles.smallBtn, { backgroundColor: theme.colors.accent }]}>
              <Text variant="bodySmall" color={theme.colors.textOnAccent}>{t('common.save')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <MarkdownText text={comment.body} color={theme.colors.text} serverUrl={serverUrl} allowEmbeds={false} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  stateBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  bodyCard: { padding: 12, gap: 8, borderWidth: StyleSheet.hairlineWidth },
  bodyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  fields: { paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth },
  field: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  editLink: { minHeight: 32, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  // Pressable centres its children by default; these rows read left to right.
  inlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  input: { paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, borderWidth: StyleSheet.hairlineWidth },
  multiline: { minHeight: 120, maxHeight: 280 },
  actionsRight: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  smallBtn: { paddingHorizontal: 14, minHeight: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  smallBtnGhost: { paddingHorizontal: 12, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  iconHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 4, minHeight: 44, borderWidth: StyleSheet.hairlineWidth },
  attachBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 6, paddingHorizontal: 10, minHeight: 32, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10, minHeight: 48 },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5, paddingLeft: 6 },
  eventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  comment: { padding: 10, gap: 4, borderWidth: StyleSheet.hairlineWidth, marginVertical: 4, alignItems: 'stretch', justifyContent: 'flex-start' },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  commentInput: { flex: 1, minHeight: 40, maxHeight: 120 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  closeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
});
