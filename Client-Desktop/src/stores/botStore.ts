import { create } from 'zustand';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useUIStore } from './uiStore';
import type { BotCommand, BotDmConversation, BotDmMessage, BotScope } from '../types';

export interface EphemeralBotMessage {
  id?: string;
  interactionId?: string | null;
  channelId: string;
  threadId?: string | null;
  botUserId: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  content: string;
  interaction?: { command: string; invokerId: string; invokerName: string } | null;
  created_at: number;
}

export type InvokeResult =
  | { status: 'ok'; interactionId: string }
  | { status: 'consent_required' }
  | { status: 'denied' | 'missing_permission' | 'unknown_bot' | 'unknown_command' | 'bot_offline' | 'invalid' | 'error'; error?: string };

interface InvokeAck {
  status: string;
  error?: string;
  interactionId?: string;
  bot?: { id: string; userId: string; username: string | null; displayName: string | null; avatar: string | null };
  requestedScopes?: BotScope[];
}

interface BotState {
  commands: BotCommand[];
  commandsFetchedAt: number;
  // Ephemeral "only you can see this" bot responses, keyed by channel.
  ephemeralByChannel: Record<string, EphemeralBotMessage[]>;
  // Bot DMs
  conversations: BotDmConversation[];
  messagesByBot: Record<string, BotDmMessage[]>;
  activeBotDmId: string | null;
  botDmsOpen: boolean;

  fetchCommands: (force?: boolean) => Promise<void>;
  invokeCommand: (params: {
    botId: string;
    command: string;
    channelId: string;
    threadId?: string | null;
    replyToId?: string | null;
    targetMessageId?: string | null;
    options?: Record<string, string | number | boolean>;
  }) => Promise<InvokeResult>;
  addEphemeral: (msg: EphemeralBotMessage) => void;
  dismissEphemeral: (channelId: string, index: number) => void;

  fetchConversations: () => Promise<void>;
  fetchDmMessages: (botId: string) => Promise<void>;
  openBotDms: (botId?: string | null) => void;
  closeBotDms: () => void;
  handleIncomingBotDm: (msg: { id: string; botId: string; botUserId: string; username: string; displayName?: string | null; avatar?: string | null; sender: 'bot'; content: string; created_at: number }) => void;
  replyToBot: (botId: string, content: string) => Promise<boolean>;
  markConversationRead: (botId: string) => Promise<void>;
  totalUnread: () => number;
  reset: () => void;
}

export const useBotStore = create<BotState>((set, get) => ({
  commands: [],
  commandsFetchedAt: 0,
  ephemeralByChannel: {},
  conversations: [],
  messagesByBot: {},
  activeBotDmId: null,
  botDmsOpen: false,

  fetchCommands: async (force = false) => {
    const { commandsFetchedAt } = get();
    if (!force && commandsFetchedAt && Date.now() - commandsFetchedAt < 60_000) return;
    try {
      const data = await api.get('/api/bots/commands');
      set({
        commands: Array.isArray(data?.commands) ? data.commands : [],
        commandsFetchedAt: Date.now(),
      });
    } catch {
      // Older servers without the bots API — leave the command list empty.
      set({ commandsFetchedAt: Date.now() });
    }
  },

  invokeCommand: ({ botId, command, channelId, threadId, replyToId, targetMessageId, options }) => {
    return new Promise<InvokeResult>((resolve) => {
      const socket = getSocket();
      if (!socket) return resolve({ status: 'error', error: 'Not connected' });
      socket.emit(
        'interaction:invoke',
        {
          botId, command, channelId, threadId: threadId ?? null,
          replyToId: replyToId ?? null, targetMessageId: targetMessageId ?? null, options: options ?? {},
        },
        (ack: InvokeAck) => {
          if (!ack || typeof ack.status !== 'string') return resolve({ status: 'error' });
          if (ack.status === 'ok' && ack.interactionId) {
            return resolve({ status: 'ok', interactionId: ack.interactionId });
          }
          if (ack.status === 'consent_required') {
            // Open the consent modal; on Allow, re-invoke and surface the retry result nowhere
            // (the bot's reply arriving in-channel is the feedback).
            useUIStore.getState().openModal('botConsent', {
              botId,
              botUsername: ack.bot?.username ?? null,
              botDisplayName: ack.bot?.displayName ?? null,
              botAvatar: ack.bot?.avatar ?? null,
              requestedScopes: ack.requestedScopes ?? ['interactions'],
              onDecided: (allowed: boolean) => {
                if (allowed) {
                  void get().invokeCommand({ botId, command, channelId, threadId, replyToId, targetMessageId, options });
                }
              },
            });
            return resolve({ status: 'consent_required' });
          }
          return resolve({ status: ack.status as InvokeResult['status'], error: ack.error } as InvokeResult);
        }
      );
    });
  },

  addEphemeral: (msg) => {
    set((state) => ({
      ephemeralByChannel: {
        ...state.ephemeralByChannel,
        [msg.channelId]: [...(state.ephemeralByChannel[msg.channelId] ?? []), msg],
      },
    }));
  },

  dismissEphemeral: (channelId, index) => {
    set((state) => {
      const list = [...(state.ephemeralByChannel[channelId] ?? [])];
      list.splice(index, 1);
      return { ephemeralByChannel: { ...state.ephemeralByChannel, [channelId]: list } };
    });
  },

  fetchConversations: async () => {
    try {
      const data = await api.get('/api/bots/dms');
      set({ conversations: Array.isArray(data?.conversations) ? data.conversations : [] });
    } catch {
      // Older servers — no bot DMs.
    }
  },

  fetchDmMessages: async (botId) => {
    try {
      const data = await api.get(`/api/bots/dms/${botId}`);
      set((state) => ({
        messagesByBot: { ...state.messagesByBot, [botId]: Array.isArray(data?.messages) ? data.messages : [] },
      }));
    } catch {
      // ignore
    }
  },

  openBotDms: (botId = null) => {
    set({ botDmsOpen: true, activeBotDmId: botId });
    void get().fetchConversations();
    if (botId) {
      void get().fetchDmMessages(botId);
      void get().markConversationRead(botId);
    }
  },

  closeBotDms: () => set({ botDmsOpen: false, activeBotDmId: null }),

  handleIncomingBotDm: (msg) => {
    set((state) => {
      const existing = state.messagesByBot[msg.botId];
      const messagesByBot = existing
        ? { ...state.messagesByBot, [msg.botId]: [...existing, { id: msg.id, botId: msg.botId, sender: msg.sender, content: msg.content, created_at: msg.created_at }] }
        : state.messagesByBot;

      const withoutBot = state.conversations.filter((c) => c.botId !== msg.botId);
      const prev = state.conversations.find((c) => c.botId === msg.botId);
      const isViewing = state.botDmsOpen && state.activeBotDmId === msg.botId;
      const conversations: BotDmConversation[] = [
        {
          botId: msg.botId,
          botUserId: msg.botUserId,
          username: msg.username,
          displayName: msg.displayName ?? prev?.displayName ?? null,
          avatar: msg.avatar ?? prev?.avatar ?? null,
          unread: isViewing ? 0 : (prev?.unread ?? 0) + 1,
          lastMessageAt: msg.created_at,
        },
        ...withoutBot,
      ];
      return { messagesByBot, conversations };
    });
    const { botDmsOpen, activeBotDmId } = get();
    if (botDmsOpen && activeBotDmId === msg.botId) {
      void get().markConversationRead(msg.botId);
    }
  },

  replyToBot: (botId, content) => {
    return new Promise<boolean>((resolve) => {
      const socket = getSocket();
      if (!socket) return resolve(false);
      socket.emit('bot:dm:reply', { botId, content }, (ack: { status?: string; id?: string }) => {
        if (ack?.status === 'ok' && ack.id) {
          set((state) => ({
            messagesByBot: {
              ...state.messagesByBot,
              [botId]: [
                ...(state.messagesByBot[botId] ?? []),
                { id: ack.id!, botId, sender: 'user', content, created_at: Math.floor(Date.now() / 1000) },
              ],
            },
          }));
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  },

  markConversationRead: async (botId) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.botId === botId ? { ...c, unread: 0 } : c)),
    }));
    try {
      await api.post(`/api/bots/dms/${botId}/read`);
    } catch {
      // ignore
    }
  },

  totalUnread: () => get().conversations.reduce((sum, c) => sum + (c.unread || 0), 0),

  reset: () => set({
    commands: [],
    commandsFetchedAt: 0,
    ephemeralByChannel: {},
    conversations: [],
    messagesByBot: {},
    activeBotDmId: null,
    botDmsOpen: false,
  }),
}));
