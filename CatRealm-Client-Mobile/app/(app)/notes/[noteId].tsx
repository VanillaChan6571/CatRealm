/**
 * Note editor — full-screen, autosave on 1.5s debounce.
 * Mirrors the web NoteEditorPanel behaviour.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Lock, Trash2, ChevronLeft, Eye, Pencil } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Pressable } from '@/components';
import { MarkdownText } from '@/components/MarkdownText';
import { usePersonalNotesStore, type PersonalNoteContent } from '@/stores/personalNotesStore';
import { NoteUnlockModal } from '@/components/notes/NoteUnlockModal';
import { NoteLockModal } from '@/components/notes/NoteLockModal';

export default function NoteEditorScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { noteId } = useLocalSearchParams<{ noteId: string }>();

  const notes = usePersonalNotesStore((s) => s.notes);
  const loadNoteContent = usePersonalNotesStore((s) => s.loadNoteContent);
  const updateNote = usePersonalNotesStore((s) => s.updateNote);
  const deleteNote = usePersonalNotesStore((s) => s.deleteNote);

  const noteMeta = notes.find((n) => n.id === noteId);
  const lockType = noteMeta?.lockType ?? null;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isLocked, setIsLocked] = useState(lockType !== null);
  const [previewMode, setPreviewMode] = useState(true);
  const [showUnlock, setShowUnlock] = useState(false);
  const [showLockModal, setShowLockModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  const unlockedPinRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);

  // Load note content on mount
  useEffect(() => {
    setTitle('');
    setBody('');
    setSaving(false);
    setSavedMsg(null);
    setPreviewMode(true);
    isDirtyRef.current = false;
    unlockedPinRef.current = null;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    if (lockType !== null) {
      setIsLocked(true);
      setShowUnlock(true);
    } else {
      setIsLocked(false);
      setLoadingContent(true);
      void loadNoteContent(noteId).then((content) => {
        if (content) {
          setTitle(content.title);
          setBody(content.body);
        }
        setLoadingContent(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const scheduleSave = useCallback(
    (newTitle: string, newBody: string) => {
      isDirtyRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        setSaving(true);
        const opts = unlockedPinRef.current ? { pin: unlockedPinRef.current } : undefined;
        void updateNote(noteId, newTitle, newBody, opts).then(() => {
          setSaving(false);
          const now = new Date();
          setSavedMsg(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
        });
        isDirtyRef.current = false;
      }, 1500);
    },
    [noteId, updateNote],
  );

  function handleUnlocked(content: PersonalNoteContent, pin?: string) {
    setTitle(content.title);
    setBody(content.body);
    setIsLocked(false);
    setShowUnlock(false);
    unlockedPinRef.current = pin ?? null;
  }

  function handleDelete() {
    Alert.alert(t('notes.deleteNoteTitle'), t('notes.deleteNoteMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          await deleteNote(noteId);
          router.back();
        },
      },
    ]);
  }

  if (!noteMeta) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgApp }} edges={['top']}>
      {/* Toolbar */}
      <View style={[styles.toolbar, { borderBottomColor: theme.colors.lineSoft }]}>
        <Pressable haptic onPress={() => router.back()} style={styles.toolbarBtn}>
          <ChevronLeft color={theme.colors.accent} size={20} />
          <Text variant="bodySmall" color={theme.colors.accent}>{t('notes.breadcrumb')}</Text>
        </Pressable>

        <View style={styles.toolbarRight}>
          {saving ? (
            <ActivityIndicator size="small" color={theme.colors.text3} />
          ) : savedMsg ? (
            <Text variant="caption" color="#4ade80">{t('notes.saved', { time: savedMsg })}</Text>
          ) : null}

          {!isLocked && (
            <>
              <Pressable
                haptic
                onPress={() => setPreviewMode((v) => !v)}
                style={[
                  styles.toolbarBtn,
                  { backgroundColor: previewMode ? theme.colors.accent + '22' : undefined, borderRadius: 8 },
                ]}
              >
                {previewMode
                  ? <Pencil color={theme.colors.accent} size={17} />
                  : <Eye color={theme.colors.text3} size={17} />
                }
              </Pressable>
              <Pressable
                haptic
                onPress={() => setShowLockModal(true)}
                style={[
                  styles.toolbarBtn,
                  lockType ? { backgroundColor: theme.colors.accent + '22', borderRadius: 8 } : undefined,
                ]}
              >
                <Lock color={lockType ? theme.colors.accent : theme.colors.text3} size={18} />
              </Pressable>
            </>
          )}

          <Pressable haptic onPress={handleDelete} style={styles.toolbarBtn}>
            <Trash2 color={theme.colors.danger} size={18} />
          </Pressable>
        </View>
      </View>

      {/* Locked state */}
      {isLocked ? (
        <View style={styles.lockedState}>
          <Lock color={theme.colors.text3} size={40} strokeWidth={1.5} />
          <Text variant="body" color={theme.colors.text3} style={{ marginTop: 12 }}>
            {t('notes.noteLocked')}
          </Text>
          <Pressable
            haptic
            onPress={() => setShowUnlock(true)}
            style={[styles.unlockBtn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md }]}
          >
            <Text variant="body" color={theme.colors.textOnAccent}>{t('notes.unlockNote')}</Text>
          </Pressable>
        </View>
      ) : loadingContent ? (
        <View style={styles.lockedState}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {previewMode ? (
            /* Preview mode — rendered markdown */
            <>
              <Text style={[styles.titleInput, { color: theme.colors.text }]} numberOfLines={0}>
                {title || t('notes.untitledNote')}
              </Text>
              {body ? (
                <MarkdownText text={body} color={theme.colors.text} />
              ) : (
                <Text style={{ color: theme.colors.text3, fontSize: 15 }}>{t('notes.nothingToPreview')}</Text>
              )}
            </>
          ) : (
            /* Edit mode — plain text inputs */
            <>
              <TextInput
                value={title}
                onChangeText={(v) => { setTitle(v); scheduleSave(v, body); }}
                placeholder={t('notes.titlePlaceholder')}
                placeholderTextColor={theme.colors.text3}
                style={[styles.titleInput, { color: theme.colors.text }]}
                multiline={false}
              />
              <TextInput
                value={body}
                onChangeText={(v) => { setBody(v); scheduleSave(title, v); }}
                placeholder={t('notes.bodyPlaceholder')}
                placeholderTextColor={theme.colors.text3}
                style={[styles.bodyInput, { color: theme.colors.text }]}
                multiline
                textAlignVertical="top"
                autoCorrect
              />
            </>
          )}
        </ScrollView>
      )}

      {/* Unlock modal */}
      {lockType && (
        <NoteUnlockModal
          visible={showUnlock}
          onClose={() => setShowUnlock(false)}
          noteId={noteId}
          lockType={lockType}
          onUnlocked={handleUnlocked}
        />
      )}

      {/* Lock settings modal */}
      <NoteLockModal
        visible={showLockModal}
        onClose={() => setShowLockModal(false)}
        noteId={noteId}
        currentTitle={title}
        currentBody={body}
        currentLockType={lockType}
        onLockChanged={(newPin) => { unlockedPinRef.current = newPin; }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 6,
  },
  toolbarRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  lockedState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  unlockBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    marginTop: 12,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
    padding: 0,
  },
  bodyInput: {
    fontSize: 15,
    lineHeight: 24,
    minHeight: 300,
    padding: 0,
  },
});
