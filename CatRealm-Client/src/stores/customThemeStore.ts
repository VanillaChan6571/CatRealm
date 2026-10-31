import { create } from 'zustand';

export type CustomTheme = {
  id: string;
  themeName: string;
  author: string;
  version: string;
  source: string;
  colors: Record<string, string>;
};

interface CustomThemeState {
  themes: CustomTheme[];
  addTheme: (theme: Omit<CustomTheme, 'id'> & { id?: string }) => string;
  removeTheme: (id: string) => void;
}

const STORAGE_KEY = 'catrealm.custom-themes';

function toThemeId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function loadThemes(): CustomTheme[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveThemes(themes: CustomTheme[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
  } catch {
    // ignore storage errors
  }
}

export const useCustomThemeStore = create<CustomThemeState>((set, get) => ({
  themes: loadThemes(),

  addTheme: (theme) => {
    const { themes } = get();
    const baseId = toThemeId(theme.themeName) || 'custom-theme';
    let id = baseId;
    let counter = 2;
    while (themes.some((t) => t.id === id)) {
      id = `${baseId}-${counter}`;
      counter++;
    }
    const newTheme: CustomTheme = { ...theme, id };
    const next = [...themes, newTheme];
    set({ themes: next });
    saveThemes(next);
    return id;
  },

  removeTheme: (id) => {
    const next = get().themes.filter((t) => t.id !== id);
    set({ themes: next });
    saveThemes(next);
  },
}));
