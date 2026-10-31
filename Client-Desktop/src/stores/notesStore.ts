import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotesState {
  notes: Record<string, string>; // userId -> note
  setNote: (userId: string, note: string) => void;
  removeNote: (userId: string) => void;
  loadNotes: (notes: Array<{ target_user_id: string; note: string }>) => void;
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
      notes: {},
      setNote: (userId, note) =>
        set((state) => ({ notes: { ...state.notes, [userId]: note } })),
      removeNote: (userId) =>
        set((state) => {
          const { [userId]: _, ...rest } = state.notes;
          return { notes: rest };
        }),
      loadNotes: (notes) =>
        set({
          notes: notes.reduce((acc, n) => {
            acc[n.target_user_id] = n.note;
            return acc;
          }, {} as Record<string, string>),
        }),
    }),
    { name: 'catrealm-notes' }
  )
);
