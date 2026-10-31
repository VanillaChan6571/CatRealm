/**
 * Group chat store — multi-party encrypted chats.
 */
import { create } from 'zustand';
import { createAuthenticatedApi } from '@/lib/api';
import { decryptGroupChatMessage, encryptGroupChatMessage } from '@/utils/groupChatCrypto';
import type { GroupChatSummary, GroupChatMessage, GroupChatReaction, MessageAttachment } from '@/types';
import { appendFormDataFile } from '@/lib/formData';

// ─── Key cache ──────────────────────────────────────────────────────────────

interface GroupKey {
  keyVersion: number;
  keyMaterial: string;
}

/** File picked on-device, sent as multipart alongside the encrypted payload. */
export type GroupLocalAttachment = {
  uri: string;
  name: string;
  mime: string;
  isNsfw?: boolean;
};

function resolveKeyMaterial(keys: GroupKey[], keyVersion: number): string | null {
  return keys.find((k) => k.keyVersion === keyVersion)?.keyMaterial ?? null;
}

// ─── Raw server message shape ───────────────────────────────────────────────

interface RawGroupMessage {
  id: string;
  groupChatId?: string;
  group_chat_id?: string;
  senderId?: string;
  sender_id?: string;
  username?: string;
  display_name?: string;
  displayName?: string;
  avatar?: string;
  encryptedPayload?: string;
  encrypted_payload?: string;
  keyVersion?: number;
  key_version?: number;
  messageType?: string;
  message_type?: string;
  systemType?: string | null;
  system_type?: string | null;
  systemData?: Record<string, unknown> | null;
  system_data?: Record<string, unknown> | null;
  systemText?: string | null;
  system_text?: string | null;
  attachmentUrl?: string | null;
  attachment_url?: string | null;
  attachmentType?: string | null;
  attachment_type?: string | null;
  attachmentSize?: number | null;
  attachment_size?: number | null;
  attachmentName?: string | null;
  attachment_name?: string | null;
  attachments?: MessageAttachment[] | null;
  nsfwTags?: string[];
  nsfw_tags?: string[];
  reactions?: { emoji: string; count: number; selfReacted?: boolean; reacted?: boolean; users?: string[] }[];
  createdAt?: number;
  created_at?: number;
  isOwner?: boolean | number;
  is_owner?: boolean | number;
}

async function decryptRaw(raw: RawGroupMessage, keys: GroupKey[]): Promise<GroupChatMessage> {
  const keyVersion = Number(raw.keyVersion ?? raw.key_version ?? 1);
  const encryptedPayload = raw.encryptedPayload ?? raw.encrypted_payload ?? '';
  const msgType = raw.messageType ?? raw.message_type ?? 'user';
  const sysText = raw.systemText ?? raw.system_text ?? null;

  let text = '';
  if (msgType === 'system') {
    const data = raw.systemData ?? raw.system_data ?? null;
    const actor = data && typeof data.actorDisplayName === 'string' && data.actorDisplayName
      ? data.actorDisplayName
      : data && typeof data.actorUsername === 'string' && data.actorUsername
        ? data.actorUsername
        : 'Someone';
    const systemType = raw.systemType ?? raw.system_type;
    if (sysText) {
      text = sysText;
    } else if (systemType === 'call_started') {
      text = `${actor} started a call`;
    } else if (systemType === 'call_ended') {
      text = 'Call ended';
    } else if (systemType === 'central_limit_warning') {
      text = (data && typeof data.warningText === 'string' && data.warningText)
        ? data.warningText
        : "Modified Clients are welcomed but not to overwhelm central's resources! If you continue this or attempt to override Central's Limitations your account will be limited.";
    } else if (systemType === 'central_account_limited') {
      const limitedUntil = data && typeof data.limitedUntil === 'number' ? data.limitedUntil : null;
      const untilLabel = limitedUntil
        ? new Date(limitedUntil * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;
      text = untilLabel
        ? `This account has been limited by Central: DM and group-chat calls are disabled until ${untilLabel}.`
        : 'This account has been limited by Central: DM and group-chat calls are disabled for 14 days.';
    } else {
      text = '';
    }
  } else if (encryptedPayload) {
    const keyMaterial = resolveKeyMaterial(keys, keyVersion);
    if (keyMaterial) {
      try {
        text = await decryptGroupChatMessage(encryptedPayload, keyMaterial);
      } catch {
        text = `[Unable to decrypt message (key v${keyVersion})]`;
      }
    } else {
      text = `[Missing group key v${keyVersion}]`;
    }
  }

  const rawAt = raw.createdAt ?? raw.created_at ?? 0;
  const createdAt = rawAt < 10_000_000_000 ? rawAt * 1000 : rawAt;

  return {
    id: raw.id,
    groupChatId: raw.groupChatId ?? raw.group_chat_id ?? '',
    senderId: raw.senderId ?? raw.sender_id ?? '',
    senderUsername: raw.username ?? '',
    senderDisplayName: raw.display_name ?? raw.displayName ?? null,
    senderAvatar: raw.avatar ?? null,
    senderIsOwner: !!(raw.isOwner ?? raw.is_owner ?? false),
    text,
    messageType: msgType === 'system' ? 'system' : 'user',
    systemType: raw.systemType ?? raw.system_type ?? null,
    systemData: raw.systemData ?? raw.system_data ?? null,
    keyVersion,
    attachmentUrl: raw.attachmentUrl ?? raw.attachment_url ?? null,
    attachmentType: raw.attachmentType ?? raw.attachment_type ?? null,
    attachmentSize: raw.attachmentSize ?? raw.attachment_size ?? null,
    attachmentName: raw.attachmentName ?? raw.attachment_name ?? null,
    attachments: (raw.attachments ?? null) as MessageAttachment[] | null,
    nsfwTags: raw.nsfwTags ?? raw.nsfw_tags ?? [],
    reactions: (raw.reactions ?? []).map((r) => ({
      emoji: r.emoji,
      count: r.count,
      users: r.users ?? [],
      reacted: r.reacted ?? r.selfReacted ?? false,
    })),
    createdAt,
  };
}

// ─── Store ──────────────────────────────────────────────────────────────────

const EMPTY_GROUPS: GroupChatSummary[] = [];
const EMPTY_MSGS: GroupChatMessage[] = [];

interface GroupChatState {
  groups: GroupChatSummary[];
  messagesByGroup: Record<string, GroupChatMessage[]>;
  keysByGroup: Record<string, GroupKey[]>;

  fetchGroups: () => Promise<void>;
  fetchKeys: (groupChatId: string) => Promise<GroupKey[]>;
  fetchMessages: (groupChatId: string) => Promise<void>;
  fetchOlderMessages: (groupChatId: string, beforeMs: number) => Promise<boolean>;
  appendDecryptedMessage: (groupChatId: string, raw: RawGroupMessage) => Promise<void>;
  sendMessage: (groupChatId: string, content: string, attachments?: GroupLocalAttachment[]) => Promise<boolean>;
  markRead: (groupChatId: string) => Promise<void>;
  applyReactionUpdate: (groupChatId: string, messageId: string, reactions: GroupChatReaction[]) => void;
  toggleReaction: (groupChatId: string, messageId: string, emoji: string) => Promise<void>;
  editMessage: (groupChatId: string, messageId: string, nextText: string) => Promise<boolean>;
  deleteMessage: (groupChatId: string, messageId: string) => Promise<boolean>;
}

export type { RawGroupMessage };

export const useGroupChatStore = create<GroupChatState>((set, get) => ({
  groups: EMPTY_GROUPS,
  messagesByGroup: {},
  keysByGroup: {},

  fetchGroups: async () => {
    const res = await createAuthenticatedApi().get<GroupChatSummary[]>('/api/group-chats').catch(() => null);
    if (!res?.data) return;
    const serverGroups = Array.isArray(res.data) ? res.data : EMPTY_GROUPS;
    set((s) => {
      const localMap = new Map(s.groups.map((g) => [g.id, g]));
      return {
        groups: serverGroups.map((serverGroup) => {
          const local = localMap.get(serverGroup.id);
          if (!local) return serverGroup;
          return { ...serverGroup, unreadCount: Math.min(local.unreadCount, serverGroup.unreadCount) };
        }),
      };
    });
  },

  fetchKeys: async (groupChatId) => {
    const cached = get().keysByGroup[groupChatId];
    if (cached?.length) return cached;
    const res = await createAuthenticatedApi()
      .get<{ keys: GroupKey[] }>(`/api/group-chats/${groupChatId}/keys`)
      .catch(() => null);
    const keys: GroupKey[] = res?.data?.keys ?? [];
    set((s) => ({ keysByGroup: { ...s.keysByGroup, [groupChatId]: keys } }));
    return keys;
  },

  fetchMessages: async (groupChatId) => {
    const keys = await get().fetchKeys(groupChatId);
    const res = await createAuthenticatedApi()
      .get<{ messages: RawGroupMessage[] }>(`/api/group-chats/${groupChatId}/messages`, { params: { limit: 50 } })
      .catch(() => null);
    const raws = res?.data?.messages ?? [];
    const decrypted = await Promise.all(raws.map((r) => decryptRaw(r, keys)));
    set((s) => ({ messagesByGroup: { ...s.messagesByGroup, [groupChatId]: decrypted } }));
  },

  fetchOlderMessages: async (groupChatId, beforeMs) => {
    const keys = await get().fetchKeys(groupChatId);
    const res = await createAuthenticatedApi()
      .get<{ messages: RawGroupMessage[] }>(`/api/group-chats/${groupChatId}/messages`, {
        params: { limit: 50, before: beforeMs },
      })
      .catch(() => null);
    const raws = res?.data?.messages ?? [];
    const older = await Promise.all(raws.map((r) => decryptRaw(r, keys)));
    set((s) => {
      const existing = s.messagesByGroup[groupChatId] ?? EMPTY_MSGS;
      const ids = new Set(existing.map((m) => m.id));
      const fresh = older.filter((m) => !ids.has(m.id));
      return { messagesByGroup: { ...s.messagesByGroup, [groupChatId]: [...fresh, ...existing] } };
    });
    return raws.length >= 50;
  },

  appendDecryptedMessage: async (groupChatId, raw) => {
    const keys = await get().fetchKeys(groupChatId);
    const msg = await decryptRaw(raw, keys);
    set((s) => {
      const existing = s.messagesByGroup[groupChatId] ?? EMPTY_MSGS;
      if (existing.some((m) => m.id === msg.id)) return s;
      return { messagesByGroup: { ...s.messagesByGroup, [groupChatId]: [...existing, msg] } };
    });
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupChatId ? { ...g, lastMessageAt: msg.createdAt } : g,
      ),
    }));
  },

  sendMessage: async (groupChatId, content, attachments) => {
    const trimmed = content.trim();
    const files = attachments ?? [];
    if (!trimmed && files.length === 0) return false;
    let keys = get().keysByGroup[groupChatId];
    if (!keys?.length) keys = await get().fetchKeys(groupChatId);
    const group = get().groups.find((g) => g.id === groupChatId);
    if (!group) return false;
    const keyVersion = group.activeKeyVersion;
    const keyMaterial = resolveKeyMaterial(keys, keyVersion);
    if (!keyMaterial) return false;
    const encryptedPayload = await encryptGroupChatMessage(trimmed, keyMaterial);
    try {
      if (files.length > 0) {
        // Multipart straight to central; server stores/compresses the files.
        const formData = new FormData();
        formData.append('encryptedPayload', encryptedPayload);
        formData.append('keyVersion', String(keyVersion));
        for (const file of files) {
          await appendFormDataFile(formData, 'attachment', {
            uri: file.uri,
            name: file.name,
            type: file.mime,
          });
        }
        const nsfwTags = files.some((file) => file.isNsfw) ? ['nsfw'] : [];
        if (nsfwTags.length > 0) formData.append('nsfwTags', JSON.stringify(nsfwTags));
        await createAuthenticatedApi().post(`/api/group-chats/${groupChatId}/messages`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        await createAuthenticatedApi().post(`/api/group-chats/${groupChatId}/messages`, { encryptedPayload, keyVersion });
      }
      return true;
    } catch {
      return false;
    }
  },

  markRead: async (groupChatId) => {
    await createAuthenticatedApi().post(`/api/group-chats/${groupChatId}/mark-read`, {}).catch(() => null);
    set((s) => ({
      groups: s.groups.map((g) => (g.id === groupChatId ? { ...g, unreadCount: 0 } : g)),
    }));
  },

  applyReactionUpdate: (groupChatId, messageId, reactions) => {
    set((s) => {
      const existing = s.messagesByGroup[groupChatId];
      if (!existing) return s;
      const idx = existing.findIndex((m) => m.id === messageId);
      if (idx === -1) return s;
      const updated = [...existing];
      updated[idx] = { ...updated[idx], reactions };
      return { messagesByGroup: { ...s.messagesByGroup, [groupChatId]: updated } };
    });
  },

  toggleReaction: async (groupChatId, messageId, emoji) => {
    const res = await createAuthenticatedApi()
      .post<{ reactions?: GroupChatReaction[] }>(`/api/group-chats/${groupChatId}/messages/${messageId}/reactions`, { emoji })
      .catch(() => null);
    if (res?.data?.reactions) {
      get().applyReactionUpdate(groupChatId, messageId, res.data.reactions);
    }
  },

  // Edit/delete update the local list on success: mobile has no gc:message:update/delete socket handlers yet.
  editMessage: async (groupChatId, messageId, nextText) => {
    const trimmed = nextText.trim();
    if (!trimmed) return false;
    let keys = get().keysByGroup[groupChatId];
    if (!keys?.length) keys = await get().fetchKeys(groupChatId);
    const keyVersion = get().groups.find((g) => g.id === groupChatId)?.activeKeyVersion;
    const keyMaterial = keyVersion != null ? resolveKeyMaterial(keys, keyVersion) : null;
    if (keyVersion == null || !keyMaterial) return false;
    try {
      const encryptedPayload = await encryptGroupChatMessage(trimmed, keyMaterial);
      await createAuthenticatedApi().patch(`/api/group-chats/${groupChatId}/messages/${messageId}`, { encryptedPayload, keyVersion });
    } catch {
      return false;
    }
    set((s) => {
      const existing = s.messagesByGroup[groupChatId];
      if (!existing) return s;
      return {
        messagesByGroup: {
          ...s.messagesByGroup,
          [groupChatId]: existing.map((m) => (m.id === messageId ? { ...m, text: trimmed, keyVersion } : m)),
        },
      };
    });
    return true;
  },

  deleteMessage: async (groupChatId, messageId) => {
    const ok = await createAuthenticatedApi()
      .delete(`/api/group-chats/${groupChatId}/messages/${messageId}`)
      .then(() => true, () => false);
    if (!ok) return false;
    set((s) => {
      const existing = s.messagesByGroup[groupChatId];
      if (!existing) return s;
      return { messagesByGroup: { ...s.messagesByGroup, [groupChatId]: existing.filter((m) => m.id !== messageId) } };
    });
    return true;
  },
}));
