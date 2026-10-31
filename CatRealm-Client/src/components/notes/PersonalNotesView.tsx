import { useEffect } from 'react';
import { PlusIcon, LockClosedIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { usePersonalNotesStore } from '../../stores/personalNotesStore';
import { NoteEditorPanel } from './NoteEditorPanel';

function formatNoteDate(unixSec: number, t: ReturnType<typeof useTranslation>['t'], language: string): string {
  const date = new Date(unixSec * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t('notes.justNow');
  if (diffMins < 60) return t('notes.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('notes.hoursAgo', { count: diffHours });
  if (diffDays < 7) return t('notes.daysAgo', { count: diffDays });
  return date.toLocaleDateString(language, { month: 'short', day: 'numeric' });
}

export function PersonalNotesView() {
  const { t, i18n } = useTranslation();
  const notes = usePersonalNotesStore((s) => s.notes);
  const activeNoteId = usePersonalNotesStore((s) => s.activeNoteId);
  const loading = usePersonalNotesStore((s) => s.loading);
  const fetchNotes = usePersonalNotesStore((s) => s.fetchNotes);
  const fetchStorageInfo = usePersonalNotesStore((s) => s.fetchStorageInfo);
  const createNote = usePersonalNotesStore((s) => s.createNote);
  const setActiveNote = usePersonalNotesStore((s) => s.setActiveNote);

  useEffect(() => {
    void fetchNotes();
    void fetchStorageInfo();
  }, [fetchNotes, fetchStorageInfo]);

  async function handleNewNote() {
    const id = await createNote(t('notes.untitled'), '');
    if (id) setActiveNote(id);
  }

  // ── Note editor (full-width) ──────────────────────────────────────────────────
  if (activeNoteId) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <NoteEditorPanel key={activeNoteId} noteId={activeNoteId} onBack={() => setActiveNote(null)} />
      </div>
    );
  }

  // ── Notes home (list or empty state) ─────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      {loading && notes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-text-muted">{t('notes.loading')}</p>
        </div>
      ) : notes.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <DocumentTextIcon className="w-12 h-12 text-text-muted opacity-30" />
          <p className="text-sm text-text-muted">{t('notes.empty')}</p>
          <button
            type="button"
            onClick={() => { void handleNewNote(); }}
            className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            {t('notes.newNote')}
          </button>
        </div>
      ) : (
        /* Note list */
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {notes.length} {t(notes.length === 1 ? 'notes.note_one' : 'notes.note_other')}
            </span>
            <button
              type="button"
              onClick={() => { void handleNewNote(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              {t('notes.newNote')}
            </button>
          </div>

          <div className="space-y-1">
            {notes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => setActiveNote(note.id)}
                className="w-full text-left px-4 py-3 rounded-lg bg-bg-sidebar/40 hover:bg-bg-hover/60 border border-transparent hover:border-border/60 transition-colors group"
              >
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {note.lockType ? (
                      <LockClosedIcon className="w-3.5 h-3.5 shrink-0 text-text-muted" title={note.lockType === 'pin' ? t('notes.pinLocked') : t('notes.twoFactorLocked')} />
                    ) : (
                      <DocumentTextIcon className="w-3.5 h-3.5 shrink-0 text-text-muted opacity-50" />
                    )}
                    <span className="truncate text-sm font-medium text-text-primary">
                      {note.title || t('notes.untitled')}
                    </span>
                  </div>
                  <span className="text-xs text-text-muted shrink-0">{formatNoteDate(note.updatedAt, t, i18n.language)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
