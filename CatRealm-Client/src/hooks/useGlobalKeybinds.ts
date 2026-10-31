import { useEffect, useRef } from 'react';
import { KEYBIND_ACTIONS, matchesKeyCombo, normalizeKeyboardEventToCombo, type KeyCombo } from '../lib/keybinds';
import { useKeybindStore } from '../stores/keybindStore';
import { useUIStore } from '../stores/uiStore';
import { useChannelStore } from '../stores/channelStore';
import { useServerStore } from '../stores/serverStore';
import { useAuthStore } from '../stores/authStore';
import { useVoiceStore } from '../stores/voiceStore';
import { dispatchHoveredMessageShortcut } from '../messaging/chatlib/messageActions';
import { isTauriDesktop } from '../lib/desktopCapture';
import { getViewedChannelsSnapshot } from './useViewedChannels';

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function findMatchedActionIds(eventCombo: KeyCombo, bindings: ReturnType<typeof useKeybindStore.getState>['bindings']) {
  const ids: string[] = [];
  for (const action of KEYBIND_ACTIONS) {
    const combos = bindings[action.id] ?? action.defaultCombos;
    for (const combo of combos) {
      if (matchesKeyCombo(eventCombo, combo)) {
        ids.push(action.id);
        break;
      }
    }
  }
  return ids;
}

function isPushToTalkAvailable() {
  const voiceState = useVoiceStore.getState();
  return !!(voiceState.activeChannelId || voiceState.pendingChannelId);
}

function dispatchMessageInputShortcut(action: 'focusText' | 'uploadFile' | 'togglePicker', tab?: 'emojis' | 'stickers') {
  window.dispatchEvent(new CustomEvent('catrealm:keybind:message-input', { detail: { action, tab } }));
}

function hasHoveredMessageTarget() {
  return !!document.querySelector('[data-message-shortcut-hovered="1"]');
}

function cycleIndex(currentIndex: number, length: number, direction: -1 | 1) {
  if (length <= 0) return -1;
  if (currentIndex < 0) return direction > 0 ? 0 : length - 1;
  return (currentIndex + direction + length) % length;
}

export function useGlobalKeybinds() {
  const bindings = useKeybindStore((s) => s.bindings);
  const activeModal = useUIStore((s) => s.activeModal);
  const openModal = useUIStore((s) => s.openModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const toggleMemberList = useUIStore((s) => s.toggleMemberList);
  const lastServerUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const activeServerUrl = useServerStore.getState().activeServerUrl;
    if (activeServerUrl) {
      lastServerUrlRef.current = activeServerUrl;
    }
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.repeat) return;

      // Sushi (Tauri) has no app menu, so F11 needs wiring; Sparky's Electron menu already handles it.
      if (e.key === 'F11' && isTauriDesktop() && window.electron) {
        e.preventDefault();
        const { getWindowFullscreen, setWindowFullscreen } = window.electron;
        void getWindowFullscreen().then((fullscreen) => setWindowFullscreen(!fullscreen)).catch(() => {});
        return;
      }

      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('catrealm:soft-reload'));
        return;
      }

      const combo = normalizeKeyboardEventToCombo(e);
      if (!combo) return;

      const matchedActionIds = findMatchedActionIds(combo, bindings);
      if (matchedActionIds.length === 0) return;
      if (matchedActionIds.includes('voice_push_to_talk') && isPushToTalkAvailable()) {
        e.preventDefault();
        useVoiceStore.getState().pressPushToTalk();
        return;
      }
      const hoveredMessage = hasHoveredMessageTarget();
      const actionId = (hoveredMessage ? matchedActionIds.find((id) => id.startsWith('msg_')) : null) ?? matchedActionIds[0];

      // Keybind modal has its own capture listener for rebinding.
      if (activeModal === 'keybinds') return;

      // If another modal is open, only allow toggling that same modal off and opening keybinds.
      if (activeModal && actionId !== 'chat_toggle_pins_popout' && actionId !== 'nav_open_keybinds') {
        return;
      }

      const editable = isEditableTarget(e.target);
      const allowInEditable = actionId === 'nav_open_keybinds'
        || actionId === 'chat_toggle_emoji_picker'
        || actionId === 'chat_toggle_sticker_picker'
        || actionId === 'chat_upload_file'
        || actionId === 'chat_search'
        || actionId === 'voice_push_to_talk';
      if (editable && !allowInEditable) return;

      switch (actionId) {
        case 'nav_open_keybinds': {
          e.preventDefault();
          openModal('keybinds');
          return;
        }
        case 'chat_toggle_pins_popout': {
          const activeChannelId = useChannelStore.getState().activeChannelId;
          if (!activeChannelId) return;
          e.preventDefault();
          if (useUIStore.getState().activeModal === 'pins') closeModal();
          else openModal('pins');
          return;
        }
        case 'chat_toggle_member_list_or_voice_text': {
          e.preventDefault();
          toggleMemberList();
          return;
        }
        case 'chat_toggle_emoji_picker': {
          e.preventDefault();
          dispatchMessageInputShortcut('togglePicker', 'emojis');
          return;
        }
        case 'chat_toggle_sticker_picker': {
          e.preventDefault();
          dispatchMessageInputShortcut('togglePicker', 'stickers');
          return;
        }
        case 'chat_upload_file': {
          e.preventDefault();
          dispatchMessageInputShortcut('uploadFile');
          return;
        }
        case 'chat_search': {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('catrealm:keybind:chat-search'));
          return;
        }
        case 'msg_focus_text_area': {
          e.preventDefault();
          dispatchMessageInputShortcut('focusText');
          return;
        }
        case 'msg_edit':
        case 'msg_delete':
        case 'msg_pin':
        case 'msg_add_reaction':
        case 'msg_reply':
        case 'msg_forward':
        case 'msg_copy_text':
        case 'msg_mark_unread':
        case 'msg_speak': {
          if (!hoveredMessage) return;
          if (actionId === 'msg_copy_text') {
            const selected = typeof window.getSelection === 'function' ? window.getSelection()?.toString().trim() : '';
            if (selected) return;
          }
          e.preventDefault();
          dispatchHoveredMessageShortcut(actionId);
          return;
        }
        case 'nav_create_join_server': {
          e.preventDefault();
          openModal('addServer');
          return;
        }
        case 'nav_history': {
          e.preventDefault();
          if (combo.key === 'arrowleft') window.history.back();
          else if (combo.key === 'arrowright') window.history.forward();
          return;
        }
        case 'nav_between_servers': {
          const serverState = useServerStore.getState();
          const servers = serverState.servers;
          if (servers.length === 0) return;
          e.preventDefault();
          const currentIdx = servers.findIndex((s) => s.url === serverState.activeServerUrl);
          const direction: -1 | 1 = combo.key === 'arrowup' ? -1 : 1;
          const nextIdx = cycleIndex(currentIdx, servers.length, direction);
          if (nextIdx >= 0) {
            serverState.switchServer(servers[nextIdx].url);
          }
          return;
        }
        case 'nav_between_channels':
        case 'nav_unread_channels':
        case 'nav_unread_mentions': {
          const channelState = useChannelStore.getState();
          const channels = getViewedChannelsSnapshot();
          if (!channels.length) return;
          const direction: -1 | 1 = combo.key === 'arrowup' ? -1 : 1;
          let candidateChannels = channels;
          if (actionId === 'nav_unread_channels') {
            candidateChannels = channels.filter((c) => (channelState.unreadByChannel[c.id] ?? 0) > 0);
          } else if (actionId === 'nav_unread_mentions') {
            candidateChannels = channels.filter((c) => (channelState.mentionByChannel[c.id] ?? 0) > 0);
          }
          if (!candidateChannels.length) return;
          e.preventDefault();
          const currentIdx = candidateChannels.findIndex((c) => c.id === channelState.activeChannelId);
          const nextIdx = cycleIndex(currentIdx, candidateChannels.length, direction);
          if (nextIdx >= 0) {
            channelState.setActiveChannel(candidateChannels[nextIdx].id);
          }
          return;
        }
        case 'nav_current_call': {
          const voiceChannelId = useVoiceStore.getState().activeChannelId;
          if (!voiceChannelId) return;
          e.preventDefault();
          useChannelStore.getState().setActiveChannel(voiceChannelId);
          return;
        }
        case 'nav_last_server_dms': {
          e.preventDefault();
          const serverState = useServerStore.getState();
          if (serverState.activeServerUrl) {
            lastServerUrlRef.current = serverState.activeServerUrl;
            serverState.goHome();
            return;
          }
          const target = lastServerUrlRef.current;
          if (target && serverState.servers.some((s) => s.url === target)) {
            serverState.switchServer(target);
          }
          return;
        }
        case 'chat_mark_channel_read': {
          if (editable) return;
          const channelState = useChannelStore.getState();
          const channelId = channelState.activeChannelId;
          if (!channelId) return;
          e.preventDefault();
          const now = Math.floor(Date.now() / 1000);
          void channelState.setChannelPrefs(channelId, { lastReadAt: now }).catch(() => {});
          channelState.resetCounts(channelId);
          return;
        }
        case 'chat_mark_server_read': {
          if (editable) return;
          e.preventDefault();
          const authUser = useAuthStore.getState().user;
          const activeServerUrl = useServerStore.getState().activeServerUrl;
          if (authUser?.accountType === 'central' && activeServerUrl) {
            void useServerStore.getState().markServerAsRead(activeServerUrl).catch(() => {});
            return;
          }
          const channelState = useChannelStore.getState();
          const now = Math.floor(Date.now() / 1000);
          for (const channel of channelState.channels) {
            void channelState.setChannelPrefs(channel.id, { lastReadAt: now }).catch(() => {});
            channelState.resetCounts(channel.id);
          }
          return;
        }
        case 'voice_toggle_mute': {
          e.preventDefault();
          useVoiceStore.getState().toggleMute();
          return;
        }
        case 'voice_toggle_deafen': {
          e.preventDefault();
          useVoiceStore.getState().toggleDeafen();
          return;
        }
        default:
          return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const combo = normalizeKeyboardEventToCombo(e);
      if (!combo) return;
      const matchedActionIds = findMatchedActionIds(combo, bindings);
      if (!matchedActionIds.includes('voice_push_to_talk')) return;
      useVoiceStore.getState().releasePushToTalk();
    };

    const releasePushToTalk = () => {
      useVoiceStore.getState().releasePushToTalk();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releasePushToTalk);
    document.addEventListener('visibilitychange', releasePushToTalk);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releasePushToTalk);
      document.removeEventListener('visibilitychange', releasePushToTalk);
    };
  }, [bindings, activeModal, openModal, closeModal, toggleMemberList]);
}
