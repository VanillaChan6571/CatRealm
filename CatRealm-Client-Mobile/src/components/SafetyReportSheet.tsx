import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ShieldAlert } from 'lucide-react-native';
import { authApi, createApi } from '@/lib/api';
import type { MessageAttachment } from '@/types';
import { reportableSafetyArtifacts, type ReportableSafetyArtifact } from '@/lib/safetyReporting';
import { useTheme } from '@/theme';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';

type ReportReason = 'suspected_csam' | 'grooming_or_exploitation' | 'child_sexual_abuse' | 'other_child_safety';

const REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'suspected_csam', label: 'Suspected child sexual abuse material' },
  { value: 'grooming_or_exploitation', label: 'Grooming or exploitation' },
  { value: 'child_sexual_abuse', label: 'Child sexual abuse' },
  { value: 'other_child_safety', label: 'Other child-safety concern' },
];

export type SafetyReportTarget = {
  scopeKind: 'dm' | 'group_dm' | 'realm';
  scopeId: string;
  messageId: string;
  senderLabel: string;
  messageText: string;
  attachments?: MessageAttachment[] | null;
};

export function SafetyReportSheet({
  target,
  onClose,
  onSubmitted,
  realm = false,
}: {
  target: SafetyReportTarget | null;
  onClose: () => void;
  onSubmitted: (messageId: string, artifactKey: string) => void;
  realm?: boolean;
}) {
  const theme = useTheme();
  const artifacts = useMemo(
    () => reportableSafetyArtifacts(target?.messageText ?? '', target?.attachments),
    [target?.attachments, target?.messageText],
  );
  const [artifact, setArtifact] = useState<ReportableSafetyArtifact | null>(null);
  const [reason, setReason] = useState<ReportReason>('suspected_csam');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setArtifact(artifacts[0] ?? null);
    setReason('suspected_csam');
    setDetails('');
  }, [target?.messageId, artifacts]);

  const submit = async () => {
    if (!target || !artifact || submitting) return;
    setSubmitting(true);
    try {
      await (realm ? createApi() : authApi).post('/api/safety/reports', {
        ...(realm ? { channelId: target.scopeId } : { scopeKind: target.scopeKind, scopeId: target.scopeId }),
        messageId: target.messageId,
        artifactKind: artifact.kind,
        artifactKey: artifact.key,
        reason,
        details: details.trim(),
        evidence: {
          ...artifact.evidence,
          // Explicit, user-initiated disclosure of this one message. Central
          // still cannot read any other E2EE DM content.
          selectedMessageText: target.messageText,
        },
      });
      onSubmitted(target.messageId, artifact.key);
      onClose();
      Alert.alert('Report received', 'The selected item is hidden while CatRealm reviews the report.');
    } catch (error: any) {
      Alert.alert('Could not submit report', realm && error?.response?.status === 404
        ? 'This Realm does not support in-app safety reports yet. Contact its operator, or email safety@catrealm.app for a concern involving a Central account.'
        : error?.response?.data?.error || 'Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={Boolean(target)} onClose={onClose} maxHeightFraction={0.88} avoidKeyboard>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <ShieldAlert size={24} color={theme.colors.danger} />
          <View style={{ flex: 1 }}>
            <Text variant="subtitle">Report image or link</Text>
            <Text variant="caption" color={theme.colors.text3}>Sent by {target?.senderLabel || 'this user'}</Text>
          </View>
        </View>

        <Text variant="bodySmall" color={theme.colors.text2}>
          Reporting hides the selected item. CatRealm receives a copy of this selected message and artifact for safety review. Other encrypted DM messages stay private.
        </Text>

        <Text variant="caption" color={theme.colors.text3}>ITEM</Text>
        <View style={{ gap: 8 }}>
          {artifacts.map((item) => (
            <Pressable key={item.key} onPress={() => setArtifact(item)} style={[
              styles.choice,
              { borderColor: artifact?.key === item.key ? theme.colors.accent : theme.colors.lineSoft, backgroundColor: theme.colors.bgElev2 },
            ]}>
              <Text variant="bodySmall" numberOfLines={2}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text variant="caption" color={theme.colors.text3}>REASON</Text>
        <View style={{ gap: 8 }}>
          {REASONS.map((item) => (
            <Pressable key={item.value} onPress={() => setReason(item.value)} style={[
              styles.choice,
              { borderColor: reason === item.value ? theme.colors.accent : theme.colors.lineSoft, backgroundColor: theme.colors.bgElev2 },
            ]}>
              <Text variant="bodySmall">{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={details}
          onChangeText={setDetails}
          maxLength={4000}
          multiline
          placeholder="Optional context for the safety reviewer"
          placeholderTextColor={theme.colors.text3}
          style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.lineSoft, backgroundColor: theme.colors.bgElev2 }]}
        />

        <Pressable disabled={!artifact || submitting} onPress={() => void submit()} style={[
          styles.submit,
          { backgroundColor: theme.colors.danger, opacity: !artifact || submitting ? 0.55 : 1 },
        ]}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Submit safety report</Text>}
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  choice: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  input: { minHeight: 92, borderWidth: 1, borderRadius: 10, padding: 12, textAlignVertical: 'top' },
  submit: { minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
