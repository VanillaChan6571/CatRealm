export type KeybindCategoryId = 'chat' | 'messages' | 'navigation' | 'voiceVideo';

export interface KeyCombo {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  anyKey?: boolean;
}

export interface KeybindCategory {
  id: KeybindCategoryId;
  title: string;
  description?: string;
}

export interface KeybindActionDefinition {
  id: string;
  categoryId: KeybindCategoryId;
  label: string;
  defaultCombos: KeyCombo[];
  editable?: boolean;
  helperText?: string;
}

export const KEYBIND_CATEGORIES: KeybindCategory[] = [
  { id: 'chat', title: 'Chat' },
  { id: 'messages', title: 'Messages', description: 'These shortcuts work when focused on a message.' },
  { id: 'navigation', title: 'Navigation' },
  { id: 'voiceVideo', title: 'Voice and Video' },
];

const combo = (key: string, mods?: Partial<KeyCombo>): KeyCombo => ({ key, ...mods });

export const KEYBIND_ACTIONS: KeybindActionDefinition[] = [
  { id: 'chat_mark_server_read', categoryId: 'chat', label: 'Mark server read', defaultCombos: [combo('escape', { shift: true })] },
  { id: 'chat_mark_channel_read', categoryId: 'chat', label: 'Mark channel as read', defaultCombos: [combo('escape')] },
  { id: 'chat_create_private_group', categoryId: 'chat', label: 'Create a private group', defaultCombos: [combo('t', { ctrl: true, shift: true })], helperText: 'Placeholder (private group creation shortcut not implemented yet).' },
  { id: 'chat_toggle_pins_popout', categoryId: 'chat', label: 'Toggle pins popout', defaultCombos: [combo('p', { ctrl: true })] },
  { id: 'chat_toggle_inbox_popout', categoryId: 'chat', label: 'Toggle inbox popout', defaultCombos: [combo('i', { ctrl: true })], helperText: 'Placeholder (inbox popout is not implemented yet).' },
  { id: 'chat_mark_top_inbox_read', categoryId: 'chat', label: 'Mark top inbox channel read', defaultCombos: [combo('e', { ctrl: true, shift: true })], helperText: 'Placeholder (inbox popout is not implemented yet).' },
  { id: 'chat_toggle_member_list_or_voice_text', categoryId: 'chat', label: 'Toggle channel member list or voice text chat', defaultCombos: [combo('u', { ctrl: true })] },
  { id: 'chat_toggle_emoji_picker', categoryId: 'chat', label: 'Toggle emoji picker', defaultCombos: [combo('e', { ctrl: true })] },
  { id: 'chat_toggle_gif_picker', categoryId: 'chat', label: 'Toggle GIF picker', defaultCombos: [combo('g', { ctrl: true })], helperText: 'Placeholder (separate GIF picker is not implemented yet).' },
  { id: 'chat_toggle_sticker_picker', categoryId: 'chat', label: 'Toggle sticker picker', defaultCombos: [combo('s', { ctrl: true })] },
  { id: 'chat_scroll_chat', categoryId: 'chat', label: 'Scroll chat up or down', defaultCombos: [combo('pageup'), combo('pagedown')] },
  { id: 'chat_jump_oldest_unread', categoryId: 'chat', label: 'Jump to oldest unread message', defaultCombos: [combo('pageup', { shift: true })] },
  { id: 'chat_focus_text_area_any', categoryId: 'chat', label: 'Focus text area', defaultCombos: [combo('any', { anyKey: true })], editable: false, helperText: 'Special behavior (Any Key) is reserved.' },
  { id: 'chat_upload_file', categoryId: 'chat', label: 'Upload a file', defaultCombos: [combo('u', { ctrl: true, shift: true })] },
  { id: 'chat_search', categoryId: 'chat', label: 'Search in current chat', defaultCombos: [combo('f', { ctrl: true })] },

  { id: 'msg_edit', categoryId: 'messages', label: 'Edit Message', defaultCombos: [combo('e')] },
  { id: 'msg_delete', categoryId: 'messages', label: 'Delete Message', defaultCombos: [combo('backspace')] },
  { id: 'msg_pin', categoryId: 'messages', label: 'Pin Message', defaultCombos: [combo('p')] },
  { id: 'msg_add_reaction', categoryId: 'messages', label: 'Add Reaction', defaultCombos: [combo('+')], helperText: 'DMs supported. Server chat keyboard reaction picker is still pending.' },
  { id: 'msg_reply', categoryId: 'messages', label: 'Reply', defaultCombos: [combo('r')] },
  { id: 'msg_forward', categoryId: 'messages', label: 'Forward Message', defaultCombos: [combo('f')] },
  { id: 'msg_speak', categoryId: 'messages', label: 'Speak Message', defaultCombos: [combo('s')] },
  { id: 'msg_copy_text', categoryId: 'messages', label: 'Copy Text', defaultCombos: [combo('c', { ctrl: true })] },
  { id: 'msg_mark_unread', categoryId: 'messages', label: 'Mark Unread', defaultCombos: [combo('enter', { alt: true })], helperText: 'DM conversation unread marker supported. Server message mark-unread is still pending.' },
  { id: 'msg_focus_text_area', categoryId: 'messages', label: 'Focus text area', defaultCombos: [combo('escape')] },

  { id: 'nav_open_keybinds', categoryId: 'navigation', label: 'Open Keybind Menu', defaultCombos: [combo('k', { ctrl: true })], editable: false, helperText: 'Ctrl+K is reserved for this menu.' },
  { id: 'nav_between_servers', categoryId: 'navigation', label: 'Navigate between servers', defaultCombos: [combo('arrowup', { ctrl: true, alt: true }), combo('arrowdown', { ctrl: true, alt: true })] },
  { id: 'nav_between_channels', categoryId: 'navigation', label: 'Navigate between channels', defaultCombos: [combo('arrowup', { alt: true }), combo('arrowdown', { alt: true })] },
  { id: 'nav_history', categoryId: 'navigation', label: 'Navigate forward and backward in page history', defaultCombos: [combo('arrowleft', { alt: true }), combo('arrowright', { alt: true })] },
  { id: 'nav_unread_channels', categoryId: 'navigation', label: 'Navigate between unread channels', defaultCombos: [combo('arrowup', { alt: true, shift: true }), combo('arrowdown', { alt: true, shift: true })] },
  { id: 'nav_unread_mentions', categoryId: 'navigation', label: 'Navigate between unread channels with mentions', defaultCombos: [combo('arrowup', { ctrl: true, alt: true, shift: true }), combo('arrowdown', { ctrl: true, alt: true, shift: true })] },
  { id: 'nav_current_call', categoryId: 'navigation', label: 'Navigate to current call', defaultCombos: [combo('v', { ctrl: true, alt: true, shift: true })] },
  { id: 'nav_last_server_dms', categoryId: 'navigation', label: 'Toggle between last server and DMs', defaultCombos: [combo('arrowright', { ctrl: true, alt: true })] },
  { id: 'nav_quickswitcher', categoryId: 'navigation', label: 'Toggle QuickSwitcher', defaultCombos: [combo('k', { ctrl: true, shift: true })], helperText: 'Placeholder (QuickSwitcher is not implemented yet). Moved from Ctrl+K because Ctrl+K opens Keybind Menu.' },
  { id: 'nav_create_join_server', categoryId: 'navigation', label: 'Create or join a server', defaultCombos: [combo('n', { ctrl: true, shift: true })] },

  { id: 'voice_toggle_mute', categoryId: 'voiceVideo', label: 'Toggle mute', defaultCombos: [combo('m', { ctrl: true, shift: true })] },
  { id: 'voice_toggle_deafen', categoryId: 'voiceVideo', label: 'Toggle deafen', defaultCombos: [combo('d', { ctrl: true, shift: true })] },
  { id: 'voice_push_to_talk', categoryId: 'voiceVideo', label: 'Push to talk', defaultCombos: [combo('`')] },
  { id: 'voice_answer_call', categoryId: 'voiceVideo', label: 'Answer incoming call', defaultCombos: [combo('enter', { ctrl: true })], helperText: 'Placeholder (DM calling is not implemented yet).' },
  { id: 'voice_decline_call', categoryId: 'voiceVideo', label: 'Decline incoming call', defaultCombos: [combo('escape')], helperText: 'Placeholder (DM calling is not implemented yet).' },
  { id: 'voice_start_dm_call', categoryId: 'voiceVideo', label: 'Start call in private message or group', defaultCombos: [combo("'", { ctrl: true })], helperText: 'Placeholder (DM calling is not implemented yet).' },
  { id: 'voice_toggle_soundboard', categoryId: 'voiceVideo', label: 'Toggle soundboard', defaultCombos: [combo('b', { ctrl: true, shift: true })], helperText: 'Placeholder (soundboard is not implemented yet).' },
];

export type KeybindMap = Record<string, Array<KeyCombo | null>>;

export function getDefaultKeybindMap(): KeybindMap {
  const out: KeybindMap = {};
  for (const action of KEYBIND_ACTIONS) {
    out[action.id] = action.defaultCombos.map((c) => ({ ...c }));
  }
  return out;
}

export function normalizeKeyboardEventToCombo(event: KeyboardEvent): KeyCombo | null {
  const rawKey = event.key;
  if (!rawKey) return null;
  const lower = rawKey.toLowerCase();
  if (lower === 'control' || lower === 'shift' || lower === 'alt' || lower === 'meta') {
    return null;
  }

  let key = lower;
  if (key === 'esc') key = 'escape';
  if (key === ' ') key = 'space';

  return {
    key,
    ctrl: event.ctrlKey || undefined,
    shift: event.shiftKey || undefined,
    alt: event.altKey || undefined,
    meta: event.metaKey || undefined,
  };
}

export function serializeKeyCombo(combo: KeyCombo): string {
  if (combo.anyKey) return 'any';
  const parts: string[] = [];
  if (combo.ctrl) parts.push('ctrl');
  if (combo.shift) parts.push('shift');
  if (combo.alt) parts.push('alt');
  if (combo.meta) parts.push('meta');
  parts.push(combo.key.toLowerCase());
  return parts.join('+');
}

export function parseKeyCombo(serialized: string): KeyCombo | null {
  if (!serialized) return null;
  if (serialized === 'any') return { key: 'any', anyKey: true };
  const parts = serialized.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return null;
  const key = parts[parts.length - 1];
  return {
    key,
    ctrl: parts.includes('ctrl') || undefined,
    shift: parts.includes('shift') || undefined,
    alt: parts.includes('alt') || undefined,
    meta: parts.includes('meta') || undefined,
  };
}

const KEY_LABELS: Record<string, string> = {
  escape: 'ESC',
  enter: 'ENTER',
  backspace: 'BACKSPACE',
  pageup: 'PAGE UP',
  pagedown: 'PAGE DOWN',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  space: 'SPACE',
  any: 'ANY KEY',
  meta: 'CMD',
};

export function formatKeyToken(token: string): string {
  if (!token) return '';
  const lower = token.toLowerCase();
  if (KEY_LABELS[lower]) return KEY_LABELS[lower];
  if (lower.length === 1) return lower.toUpperCase();
  return lower.replace(/(^|[-_\s])(\w)/g, (_m, p1: string, p2: string) => `${p1}${p2.toUpperCase()}`);
}

export function formatKeyCombo(combo: KeyCombo): string[] {
  if (combo.anyKey) return [formatKeyToken('any')];
  const out: string[] = [];
  if (combo.ctrl) out.push('CTRL');
  if (combo.shift) out.push('SHIFT');
  if (combo.alt) out.push('ALT');
  if (combo.meta) out.push('CMD');
  out.push(formatKeyToken(combo.key));
  return out;
}

export function isReservedCtrlK(combo: KeyCombo) {
  return !combo.anyKey
    && combo.key.toLowerCase() === 'k'
    && !!combo.ctrl
    && !combo.shift
    && !combo.alt
    && !combo.meta;
}

export function matchesKeyCombo(eventCombo: KeyCombo, bindingCombo: KeyCombo | null | undefined) {
  if (!bindingCombo || bindingCombo.anyKey) return false;
  return eventCombo.key.toLowerCase() === bindingCombo.key.toLowerCase()
    && !!eventCombo.ctrl === !!bindingCombo.ctrl
    && !!eventCombo.shift === !!bindingCombo.shift
    && !!eventCombo.alt === !!bindingCombo.alt
    && !!eventCombo.meta === !!bindingCombo.meta;
}
