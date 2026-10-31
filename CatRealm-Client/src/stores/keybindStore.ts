import { create } from 'zustand';
import { KEYBIND_ACTIONS, getDefaultKeybindMap, parseKeyCombo, serializeKeyCombo, type KeyCombo, type KeybindMap } from '../lib/keybinds';

interface StoredKeybinds {
  bindings: Record<string, string[]>;
}

interface KeybindState {
  bindings: KeybindMap;
  setBinding: (actionId: string, slotIndex: number, combo: KeyCombo | null) => void;
  resetAction: (actionId: string) => void;
  resetAll: () => void;
}

const STORAGE_KEY = 'catrealm.keybinds.v1';

function cloneDefaults(): KeybindMap {
  return getDefaultKeybindMap();
}

function loadBindings(): KeybindMap {
  const defaults = cloneDefaults();
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<StoredKeybinds>;
    if (!parsed || typeof parsed !== 'object' || !parsed.bindings) return defaults;

    for (const action of KEYBIND_ACTIONS) {
      const stored = parsed.bindings[action.id];
      if (!Array.isArray(stored)) continue;
      const merged = action.defaultCombos.map((defCombo, idx) => {
        const serialized = stored[idx];
        if (serialized === '') return null;
        const parsedCombo = typeof serialized === 'string' ? parseKeyCombo(serialized) : null;
        return parsedCombo ?? { ...defCombo };
      });
      defaults[action.id] = merged;
    }
    return defaults;
  } catch {
    return defaults;
  }
}

function saveBindings(bindings: KeybindMap) {
  if (typeof window === 'undefined') return;
  try {
      const payload: StoredKeybinds = { bindings: {} };
      for (const action of KEYBIND_ACTIONS) {
        const combos = bindings[action.id] ?? [];
        payload.bindings[action.id] = combos.map((combo) => (combo ? serializeKeyCombo(combo) : ''));
      }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage issues
  }
}

export const useKeybindStore = create<KeybindState>((set, get) => ({
  bindings: loadBindings(),

  setBinding: (actionId, slotIndex, combo) => {
    const current = get().bindings;
    const defaults = KEYBIND_ACTIONS.find((a) => a.id === actionId)?.defaultCombos ?? [];
    const nextActionBindings = [...(current[actionId] ?? defaults.map((c) => ({ ...c })))];
    if (combo === null) {
      nextActionBindings[slotIndex] = null;
    } else {
      nextActionBindings[slotIndex] = combo;
    }
    const next = { ...current, [actionId]: nextActionBindings };
    set({ bindings: next });
    saveBindings(next);
  },

  resetAction: (actionId) => {
    const current = get().bindings;
    const defaults = KEYBIND_ACTIONS.find((a) => a.id === actionId)?.defaultCombos.map((c) => ({ ...c })) ?? [];
    const next = { ...current, [actionId]: defaults };
    set({ bindings: next });
    saveBindings(next);
  },

  resetAll: () => {
    const defaults = cloneDefaults();
    set({ bindings: defaults });
    saveBindings(defaults);
  },
}));
