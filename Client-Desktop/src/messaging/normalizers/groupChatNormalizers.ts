import type { GroupChatDetail, GroupChatKeyVersion, GroupChatMessage, GroupChatReaction, GroupChatSummary, MessageAttachment } from '../../types';
import { decryptGroupChatMessage } from '../crypto/groupChatCrypto';

export function normalizeDetailToSummary(detail: GroupChatDetail): GroupChatSummary {
  return {
    id: detail.id,
    name: detail.name,
    avatar: detail.avatar ?? null,
    ownerId: detail.ownerId,
    ownerUsername: detail.ownerUsername,
    ownerDisplayName: detail.ownerDisplayName ?? null,
    ownerAvatar: detail.ownerAvatar ?? null,
    retentionDays: detail.retentionDays,
    activeKeyVersion: detail.activeKeyVersion,
    memberCount: detail.members.length,
    unreadCount: detail.unreadCount ?? 0,
    isOwner: detail.isOwner,
    lastMessageAt: detail.lastMessageAt ?? null,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

/**
 * `selfId` lets us derive `reacted` from `users`: Central's gc:reaction:update fan-out carries
 * `reacted` computed for the member who reacted, not for each recipient.
 */
export function normalizeGCReactions(reactions: unknown, selfId?: string | null): GroupChatReaction[] {
  if (!Array.isArray(reactions)) return [];
  return reactions
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const emoji = typeof (r as any).emoji === 'string' ? (r as any).emoji : '';
      if (!emoji) return null;
      const users = Array.isArray((r as any).users)
        ? (r as any).users.filter((u: unknown): u is string => typeof u === 'string')
        : [];
      return {
        emoji,
        count: typeof (r as any).count === 'number' ? (r as any).count : users.length,
        users,
        reacted: selfId && Array.isArray((r as any).users) ? users.includes(selfId) : (r as any).reacted === true,
      } satisfies GroupChatReaction;
    })
    .filter((r): r is GroupChatReaction => Boolean(r));
}

function keyMaterialForVersion(keys: GroupChatKeyVersion[] | undefined, keyVersion: number): string | null {
  if (!Array.isArray(keys)) return null;
  const match = keys.find((k) => k.keyVersion === keyVersion);
  return match?.keyMaterial ?? null;
}

export function normalizeGCMessageType(raw: any): 'user' | 'system' {
  return (raw?.message_type ?? raw?.messageType) === 'system' ? 'system' : 'user';
}

export function normalizeGCSystemType(raw: any): string | null {
  const value = raw?.system_type ?? raw?.systemType;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeGCSystemData(raw: any): Record<string, unknown> | null {
  const value = raw?.system_data ?? raw?.systemData;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeGCSystemText(raw: any): string {
  const value = raw?.system_text ?? raw?.systemText ?? raw?.content ?? raw?.text;
  return typeof value === 'string' ? value : '';
}

export function normalizeGCNsfwTags(raw: any): string[] {
  const value = raw?.nsfw_tags ?? raw?.nsfwTags;
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeGCServerAttachments(raw: any): MessageAttachment[] | null {
  const list = raw?.attachments;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((a: any) => ({
    url: a.url ?? '',
    type: a.type ?? null,
    mime: a.mime ?? a.type ?? null,
    size: typeof a.size === 'number' ? a.size : null,
    name: a.name ?? null,
    thumbnailUrl: a.thumbnailUrl ?? a.thumbnail_url ?? null,
    thumbnail_url: a.thumbnail_url ?? a.thumbnailUrl ?? null,
  }));
}

export async function decryptServerMessage(
  raw: any,
  keys: GroupChatKeyVersion[] | undefined,
  fallbackMembers: GroupChatDetail['members'] | undefined,
): Promise<GroupChatMessage> {
  const messageType = normalizeGCMessageType(raw);
  const keyVersion = Number(raw.key_version ?? raw.keyVersion ?? 1);
  const keyMaterial = keyMaterialForVersion(keys, keyVersion);
  let text = '';
  if (messageType === 'system') {
    text = normalizeGCSystemText(raw);
  } else if (typeof raw.encrypted_payload === 'string' || typeof raw.encryptedPayload === 'string') {
    const encryptedPayload = (raw.encrypted_payload ?? raw.encryptedPayload) as string;
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

  const senderId = String(raw.sender_id ?? raw.senderId ?? '');
  const member = fallbackMembers?.find((m) => m.id === senderId);
  return {
    id: String(raw.id),
    groupChatId: String(raw.group_chat_id ?? raw.groupChatId),
    senderId,
    senderUsername: String(raw.username ?? member?.username ?? 'unknown'),
    senderDisplayName: raw.display_name ?? raw.displayName ?? member?.displayName ?? null,
    senderAvatar: raw.avatar ?? member?.avatar ?? null,
    senderIsOwner: Boolean(raw.is_owner ?? raw.isOwner ?? member?.isOwner),
    text,
    messageType,
    systemType: normalizeGCSystemType(raw),
    systemData: normalizeGCSystemData(raw),
    keyVersion,
    attachmentUrl: raw.attachment_url ?? raw.attachmentUrl ?? null,
    attachmentType: raw.attachment_type ?? raw.attachmentType ?? null,
    attachmentSize: raw.attachment_size ?? raw.attachmentSize ?? null,
    attachmentName: raw.attachment_name ?? raw.attachmentName ?? null,
    attachments: normalizeGCServerAttachments(raw),
    nsfwTags: normalizeGCNsfwTags(raw),
    reactions: normalizeGCReactions(raw.reactions),
    createdAt: Number(raw.created_at ?? raw.createdAt ?? 0) * (Number(raw.created_at ?? raw.createdAt ?? 0) < 10_000_000_000 ? 1000 : 1),
  };
}
