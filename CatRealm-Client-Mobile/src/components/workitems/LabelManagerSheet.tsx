/**
 * LabelManagerSheet — create, rename, recolour and delete a Tracker or Board
 * channel's labels (managers only). Behavior reference:
 * CatRealm-Client/src/components/workitems/LabelManagerModal.tsx.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Check, Pencil, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Sheet } from '../Sheet';
import { createApi } from '@/lib/api';
import { apiErrorMessage, useWorkItemStore, workItemBasePath, type WorkKind } from '@/stores/workItemStore';
import type { WorkItemLabel } from '@/types';
import { LabelChip } from './shared';
import { WORK_ITEM_LIMITS } from './workItemUtils';

// Same presets as desktop; the server accepts any #rrggbb.
export const LABEL_COLORS = ['#f23f42', '#f0883e', '#f5c542', '#23a559', '#1abc9c', '#3b9eff', '#7c5cff', '#eb459e', '#8b949e'];

interface Draft { id: string | null; name: string; color: string }
const NEW_LABEL: Draft = { id: null, name: '', color: LABEL_COLORS[0] };

export function LabelManagerSheet({ kind, channelId, labels, open, onClose }: {
  kind: WorkKind;
  channelId: string;
  labels: WorkItemLabel[];
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(NEW_LABEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `${workItemBasePath(kind, channelId)}/labels`;

  useEffect(() => {
    if (!open) { setDraft(NEW_LABEL); setError(''); }
  }, [open]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      // labels-updated also arrives over the socket; fetching keeps this sheet correct without it.
      await useWorkItemStore.getState().fetchLabels(kind, channelId);
      setDraft(NEW_LABEL);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, t('work.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const name = draft.name.trim();
    if (!name || busy) return;
    const body = { name, color: draft.color.toLowerCase() };
    void run(() => (draft.id ? createApi().patch(`${base}/${draft.id}`, body) : createApi().post(base, body)));
  };

  const remove = (label: WorkItemLabel) => {
    Alert.alert(t('work.deleteLabel'), t('work.deleteLabelConfirm', { name: label.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => { void run(() => createApi().delete(`${base}/${label.id}`)); } },
    ]);
  };

  const preview: WorkItemLabel = { id: 'preview', name: draft.name.trim() || t('work.labelNamePlaceholder'), color: draft.color };

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} maxHeightFraction={0.85} avoidKeyboard maxWidth={520}>
      <Text variant="title" style={styles.title}>{t('work.labelsTitle')}</Text>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <View style={[styles.form, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.lg }]}>
          <View style={styles.formHeader}>
            <Text variant="caption" color={theme.colors.text3} style={styles.caps}>
              {draft.id ? t('work.editLabel') : t('work.newLabel')}
            </Text>
            <LabelChip label={preview} />
          </View>
          <TextInput
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            placeholder={t('work.labelNamePlaceholder')}
            placeholderTextColor={theme.colors.text3}
            maxLength={WORK_ITEM_LIMITS.labelName}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={save}
            style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgApp, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}
          />
          <View style={styles.swatches}>
            {LABEL_COLORS.map((color) => {
              const on = draft.color.toLowerCase() === color;
              return (
                <Pressable
                  key={color}
                  haptic
                  onPress={() => setDraft((d) => ({ ...d, color }))}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={color}
                  style={[styles.swatch, { backgroundColor: color, borderColor: on ? theme.colors.text : 'transparent' }]}
                >
                  {on ? <Check size={14} color="#fff" /> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actions}>
            {draft.id ? (
              <Pressable haptic onPress={() => setDraft(NEW_LABEL)} style={styles.ghostBtn}>
                <Text variant="bodySmall" color={theme.colors.text2}>{t('common.cancel')}</Text>
              </Pressable>
            ) : null}
            <Pressable haptic disabled={busy || !draft.name.trim()} onPress={save}
              style={[styles.primaryBtn, { backgroundColor: theme.colors.accent, opacity: draft.name.trim() ? 1 : 0.5 }]}>
              {busy ? <ActivityIndicator size="small" color={theme.colors.textOnAccent} /> : (
                <Text variant="bodySmall" color={theme.colors.textOnAccent}>{draft.id ? t('common.save') : t('work.add')}</Text>
              )}
            </Pressable>
          </View>
          {error ? <Text variant="bodySmall" color={theme.colors.danger}>{error}</Text> : null}
        </View>

        {labels.length === 0 ? (
          <Text variant="bodySmall" color={theme.colors.text3} style={styles.empty}>{t('work.noLabelsYet')}</Text>
        ) : labels.map((label) => (
          <View key={label.id} style={[styles.row, { borderBottomColor: theme.colors.lineSoft }]}>
            <View style={{ flex: 1, alignItems: 'flex-start' }}><LabelChip label={label} /></View>
            <Pressable haptic disabled={busy} onPress={() => setDraft({ id: label.id, name: label.name, color: label.color })}
              style={styles.iconHit} accessibilityRole="button" accessibilityLabel={t('work.editLabel')}>
              <Pencil size={16} color={theme.colors.text2} />
            </Pressable>
            <Pressable haptic disabled={busy} onPress={() => remove(label)}
              style={styles.iconHit} accessibilityRole="button" accessibilityLabel={t('work.deleteLabel')}>
              <Trash2 size={16} color={theme.colors.danger} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: 16, paddingBottom: 8 },
  body: { paddingHorizontal: 16, paddingBottom: 24, gap: 6 },
  form: { padding: 12, gap: 10, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  caps: { textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: '600' },
  input: { paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, borderWidth: StyleSheet.hairlineWidth },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 30, height: 30, minWidth: 30, minHeight: 30, borderRadius: 15, borderWidth: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  primaryBtn: { paddingHorizontal: 16, minHeight: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', minWidth: 64 },
  ghostBtn: { paddingHorizontal: 12, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 4, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  iconHit: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', paddingVertical: 16 },
});
