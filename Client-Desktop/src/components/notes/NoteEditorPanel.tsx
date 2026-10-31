import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EyeIcon,
  PencilIcon,
  LockClosedIcon,
  TrashIcon,
  ChevronLeftIcon,
} from '@heroicons/react/24/outline';
import { usePersonalNotesStore, type PersonalNoteContent } from '../../stores/personalNotesStore';
import { MessageFormatter } from '../chat/MessageFormatter';
import { NoteUnlockDialog } from './NoteUnlockDialog';
import { NoteLockDialog } from './NoteLockDialog';

interface NoteEditorPanelProps {
  noteId: string;
  onBack?: () => void;
}

function formatSavedAt(date: Date, language: string): string {
  return date.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function NoteEditorPanel({ noteId, onBack }: NoteEditorPanelProps) {
  const { t, i18n } = useTranslation();
  const notes = usePersonalNotesStore((s) => s.notes);
  const loadNoteContent = usePersonalNotesStore((s) => s.loadNoteContent);
  const updateNote = usePersonalNotesStore((s) => s.updateNote);
  const deleteNote = usePersonalNotesStore((s) => s.deleteNote);

  const noteMeta = notes.find((n) => n.id === noteId);
  const lockType = noteMeta?.lockType ?? null;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [previewMode, setPreviewMode] = useState(true);
  const [isLocked, setIsLocked] = useState(lockType !== null);
  const [saving, setSaving] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // Track the PIN used to unlock so autosave can re-encrypt with it
  const unlockedPinRef = useRef<string | null>(null);

  const isDirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load note content when noteId changes
  useEffect(() => {
    setTitle('');
    setBody('');
    setSaving(false);
    setPreviewMode(true);
    isDirtyRef.current = false;
    unlockedPinRef.current = null;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    if (lockType !== null) {
      setIsLocked(true);
      setShowUnlock(true);
    } else {
      setIsLocked(false);
      setShowUnlock(false);
      void loadNoteContent(noteId).then((content) => {
        if (content) {
          setTitle(content.title);
          setBody(content.body);
        }
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
        const saveOptions = unlockedPinRef.current ? { pin: unlockedPinRef.current } : undefined;
        void updateNote(noteId, newTitle, newBody, saveOptions).then(() => {
          setSaving(false);
          setSavedAt(new Date());
        });
        isDirtyRef.current = false;
      }, 1500);
    },
    [noteId, updateNote],
  );

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTitle(e.target.value);
    scheduleSave(e.target.value, body);
  }

  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setBody(e.target.value);
    scheduleSave(title, e.target.value);
  }

  function handleUnlocked(content: PersonalNoteContent, pin?: string) {
    setTitle(content.title);
    setBody(content.body);
    setIsLocked(false);
    setShowUnlock(false);
    unlockedPinRef.current = pin ?? null;
  }

  async function handleDelete() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await deleteNote(noteId);
    setShowDeleteConfirm(false);
  }

  if (!noteMeta) return null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar — single row: back | actions | saved timestamp */}
      <div className="flex items-center gap-1 px-3 h-10 border-b border-border shrink-0">
        {/* Back button */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors mr-1"
          >
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            {t('notes.allNotes')}
          </button>
        )}

        {/* Divider */}
        {onBack && <div className="w-px h-4 bg-border mx-1" />}

        {/* Preview toggle */}
        {!isLocked && (
          <button
            type="button"
            onClick={() => setPreviewMode((v) => !v)}
            title={previewMode ? t('notes.editMode') : t('notes.previewMode')}
            className={`p-1.5 rounded transition-colors ${
              previewMode
                ? 'bg-accent/15 text-accent'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            {previewMode ? <PencilIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
          </button>
        )}

        {/* Lock button — only shown when content is decrypted */}
        {!isLocked && (
          <button
            type="button"
            onClick={() => setShowLockDialog(true)}
            title={t('notes.manageLock')}
            className={`p-1.5 rounded transition-colors ${
              lockType
                ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            <LockClosedIcon className="w-4 h-4" />
          </button>
        )}

        {/* Delete button */}
        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            title={t('notes.deleteNote')}
            className="p-1.5 rounded text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-secondary">{t('notes.deletePrompt')}</span>
            <button
              type="button"
              onClick={() => { void handleDelete(); }}
              className="px-2 py-1 text-xs font-medium text-white bg-danger rounded hover:bg-danger/90 transition-colors"
            >
              {t('common.yes')}
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="px-2 py-1 text-xs font-medium text-text-secondary bg-bg-hover rounded hover:bg-bg-hover/80 transition-colors"
            >
              {t('common.no')}
            </button>
          </div>
        )}

        {/* Saved timestamp — right-aligned */}
        <div className="flex-1" />
        {saving ? (
          <span className="text-xs text-text-muted">{t('notes.saving')}</span>
        ) : savedAt ? (
          <span className="text-xs text-green-400">{t('notes.savedAt', { time: formatSavedAt(savedAt, i18n.language) })}</span>
        ) : null}
      </div>

      {/* Editor content */}
      {isLocked ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-text-muted">
            <LockClosedIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">{t('notes.locked')}</p>
            <button
              type="button"
              onClick={() => setShowUnlock(true)}
              className="mt-3 px-4 py-2 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
            >
              {t('notes.unlock')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Title */}
          <div className="px-5 pt-5 pb-1 shrink-0">
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              placeholder={t('notes.untitled')}
              className="w-full text-2xl font-bold text-text-primary bg-transparent border-none outline-none placeholder-text-muted"
            />
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 px-5 pb-4 overflow-y-auto">
            {previewMode ? (
              <div className="text-sm text-text-primary prose-notes min-h-full">
                {body ? (
                  <MessageFormatter text={body} allowLinks={false} allowEmbeds={false} />
                ) : (
                  <span className="text-text-muted">{t('notes.nothingPreview')}</span>
                )}
              </div>
            ) : (
              <textarea
                value={body}
                onChange={handleBodyChange}
                placeholder={t('notes.bodyPlaceholder')}
                className="w-full h-full min-h-64 resize-none text-sm text-text-primary bg-transparent border-none outline-none placeholder-text-muted font-mono leading-relaxed"
              />
            )}
          </div>
        </div>
      )}

      {/* Unlock dialog */}
      {showUnlock && lockType && (
        <NoteUnlockDialog
          open={showUnlock}
          onClose={() => setShowUnlock(false)}
          noteId={noteId}
          lockType={lockType}
          onUnlocked={handleUnlocked}
        />
      )}

      {/* Lock settings dialog */}
      {showLockDialog && (
        <NoteLockDialog
          open={showLockDialog}
          onClose={() => setShowLockDialog(false)}
          noteId={noteId}
          currentTitle={title}
          currentBody={body}
          currentLockType={lockType}
          onLockChanged={(newPin) => { unlockedPinRef.current = newPin; }}
        />
      )}

      {/* Delete confirm is inline in toolbar — no separate modal needed */}
    </div>
  );
}
