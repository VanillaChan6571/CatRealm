/**
 * My Notes — list screen. Tapping a note navigates to the editor.
 */

import { useEffect } from 'react';
import { FlatList, View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useRouter } from 'expo-router';
import { Plus, FileText, Lock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Pressable } from '@/components';
import { usePersonalNotesStore } from '@/stores/personalNotesStore';

function formatDate(unixSec: number): string {
  const date = new Date(unixSec * 1000);
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(diff / 86400000);
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotesListScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const notes = usePersonalNotesStore((s) => s.notes);
  const loading = usePersonalNotesStore((s) => s.loading);
  const storageUsed = usePersonalNotesStore((s) => s.storageUsed);
  const fetchNotes = usePersonalNotesStore((s) => s.fetchNotes);
  const fetchStorageInfo = usePersonalNotesStore((s) => s.fetchStorageInfo);
  const createNote = usePersonalNotesStore((s) => s.createNote);

  useEffect(() => {
    void fetchNotes();
    void fetchStorageInfo();
  }, [fetchNotes, fetchStorageInfo]);

  async function handleNewNote() {
    const id = await createNote(t('notes.untitledNote'), '');
    if (id) router.push({ pathname: '/notes/[noteId]', params: { noteId: id } });
  }

  const LIMIT_BYTES = 10 * 1024 * 1024;
  const pct = Math.min(storageUsed / LIMIT_BYTES, 1);
  function fmtBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgApp }} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable haptic onPress={() => router.back()} style={{ paddingRight: 8 }}>
          <Text variant="body" color={theme.colors.accent}>{t('notes.back')}</Text>
        </Pressable>
        <Text variant="display" style={{ flex: 1 }}>{t('notes.title')}</Text>
        <Pressable
          haptic
          onPress={() => { void handleNewNote(); }}
          style={[styles.newBtn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md }]}
        >
          <Plus color={theme.colors.textOnAccent} size={16} />
          <Text variant="caption" color={theme.colors.textOnAccent} style={{ fontWeight: '600' }}>{t('notes.new')}</Text>
        </Pressable>
      </View>

      {/* Storage bar — always visible so quota is clear */}
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <View style={[styles.storageTrack, { backgroundColor: theme.colors.bgElev2 }]}>
          <View style={[styles.storageFill, { backgroundColor: theme.colors.accent, width: `${pct * 100}%` as `${number}%` }]} />
        </View>
        <Text variant="caption" color={theme.colors.text3} style={{ marginTop: 3 }}>
          {fmtBytes(storageUsed)} {t('notes.storageUsed')}
        </Text>
      </View>

      {loading && notes.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : notes.length === 0 ? (
        <View style={styles.center}>
          <FileText color={theme.colors.text3} size={48} strokeWidth={1.5} />
          <Text variant="body" color={theme.colors.text3} style={{ marginTop: theme.spacing.md }}>
            {t('notes.noNotesYet')}
          </Text>
          <Pressable
            haptic
            onPress={() => { void handleNewNote(); }}
            style={[styles.emptyBtn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md }]}
          >
            <Plus color={theme.colors.textOnAccent} size={16} />
            <Text variant="body" color={theme.colors.textOnAccent}>{t('notes.newNote')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <Pressable
              haptic
              onPress={() => router.push({ pathname: '/notes/[noteId]', params: { noteId: item.id } })}
              style={[
                styles.noteRow,
                { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft, borderRadius: theme.radius.md },
              ]}
            >
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {item.lockType ? (
                  <Lock color={theme.colors.text3} size={14} />
                ) : (
                  <FileText color={theme.colors.text3} size={14} />
                )}
                <Text variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>
                  {item.title || t('notes.untitledNote')}
                </Text>
              </View>
              <Text variant="caption" color={theme.colors.text3}>{formatDate(item.updatedAt)}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  storageTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  storageFill: {
    height: 4,
    borderRadius: 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 80,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderWidth: 1,
    gap: 8,
  },
});
