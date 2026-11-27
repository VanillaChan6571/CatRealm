import type { GroupChatDetail, GroupChatKeyVersion, GroupChatMessage, GroupChatReaction, GroupChatSummary, MessageAttachment, SafetyArtifactVisibility } from '../../types';
import { decryptGroupChatMessage } from '../crypto/groupChatCrypto';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

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
      const reaction = asRecord(r);
      const emoji = typeof reaction.emoji === 'string' ? reaction.emoji : '';
      if (!emoji) return null;
      const users = Array.isArray(reaction.users)
        ? reaction.users.filter((u: unknown): u is string => typeof u === 'string')
        : [];
      return {
        emoji,
        count: typeof reaction.count === 'number' ? reaction.count : users.length,
        users,
        reacted: selfId && Array.isArray(reaction.users) ? users.includes(selfId) : reaction.reacted === true,
      } satisfies GroupChatReaction;
    })
    .filter((r): r is GroupChatReaction => Boolean(r));
}

function keyMaterialForVersion(keys: GroupChatKeyVersion[] | undefined, keyVersion: number): string | null {
  if (!Array.isArray(keys)) return null;
  const match = keys.find((k) => k.keyVersion === keyVersion);
  return match?.keyMaterial ?? null;
}

export function normalizeGCMessageType(raw: unknown): 'user' | 'system' {
  const message = asRecord(raw);
  return (message.message_type ?? message.messageType) === 'system' ? 'system' : 'user';
}

export function normalizeGCSystemType(raw: unknown): string | null {
  const message = asRecord(raw);
  const value = message.system_type ?? message.systemType;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeGCSystemData(raw: unknown): Record<string, unknown> | null {
  const message = asRecord(raw);
  const value = message.system_data ?? message.systemData;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeGCSystemText(raw: unknown): string {
  const message = asRecord(raw);
  const value = message.system_text ?? message.systemText ?? message.content ?? message.text;
  return typeof value === 'string' ? value : '';
}

export function normalizeGCNsfwTags(raw: unknown): string[] {
  const message = asRecord(raw);
  const value = message.nsfw_tags ?? message.nsfwTags;
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeGCServerAttachments(raw: unknown): MessageAttachment[] | null {
  const list = asRecord(raw).attachments;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((entry: unknown) => {
    const a = asRecord(entry);
    const type = stringOrNull(a.type);
    const thumbnailUrl = stringOrNull(a.thumbnailUrl);
    const thumbnail_url = stringOrNull(a.thumbnail_url);
    return {
      url: stringOrNull(a.url) ?? '',
      type,
      mime: stringOrNull(a.mime) ?? type,
      size: typeof a.size === 'number' ? a.size : null,
      name: stringOrNull(a.name),
      thumbnailUrl: thumbnailUrl ?? thumbnail_url,
      thumbnail_url: thumbnail_url ?? thumbnailUrl,
    };
  });
}

export async function decryptServerMessage(
  input: unknown,
  keys: GroupChatKeyVersion[] | undefined,
  fallbackMembers: GroupChatDetail['members'] | undefined,
): Promise<GroupChatMessage> {
  const raw = asRecord(input);
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
    senderDisplayName: stringOrNull(raw.display_name ?? raw.displayName) ?? member?.displayName ?? null,
    senderAvatar: stringOrNull(raw.avatar) ?? member?.avatar ?? null,
    senderIsOwner: Boolean(raw.is_owner ?? raw.isOwner ?? member?.isOwner),
    text,
    messageType,
    systemType: normalizeGCSystemType(raw),
    systemData: normalizeGCSystemData(raw),
    keyVersion,
    attachmentUrl: stringOrNull(raw.attachment_url ?? raw.attachmentUrl),
    attachmentType: stringOrNull(raw.attachment_type ?? raw.attachmentType),
    attachmentSize: typeof (raw.attachment_size ?? raw.attachmentSize) === 'number' ? (raw.attachment_size ?? raw.attachmentSize) as number : null,
    attachmentName: stringOrNull(raw.attachment_name ?? raw.attachmentName),
    attachments: normalizeGCServerAttachments(raw),
    nsfwTags: normalizeGCNsfwTags(raw),
    reactions: normalizeGCReactions(raw.reactions),
    safetyArtifacts: (Array.isArray(raw.safety_artifacts) ? raw.safety_artifacts : (Array.isArray(raw.safetyArtifacts) ? raw.safetyArtifacts : [])) as SafetyArtifactVisibility[],
    createdAt: Number(raw.created_at ?? raw.createdAt ?? 0) * (Number(raw.created_at ?? raw.createdAt ?? 0) < 10_000_000_000 ? 1000 : 1),
  };
}
