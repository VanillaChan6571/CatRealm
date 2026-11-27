import type { DMReaction, MessageAttachment } from '../../types';
import { decryptDM, decryptDMV2, getDMPayloadVersion } from '../crypto/dmCrypto';
import { loadConversationSecretForCurrentDevice } from '../crypto/dmKeyStore';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeDmReactions(reactions: unknown, userId: string | undefined): DMReaction[] {
  if (!Array.isArray(reactions)) return [];
  return reactions
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const reaction = asRecord(entry);
      const emoji = typeof reaction.emoji === 'string' ? reaction.emoji : '';
      if (!emoji) return null;
      const users = Array.isArray(reaction.users)
        ? reaction.users.filter((u: unknown): u is string => typeof u === 'string')
        : [];
      const count = typeof reaction.count === 'number' ? reaction.count : users.length;
      // Central's socket fan-out carries `reacted` computed for whoever reacted, so derive our
      // own state from `users` whenever we can and only trust the flag as a fallback.
      const reacted = userId && Array.isArray(reaction.users)
        ? users.includes(userId)
        : reaction.reacted === true;
      return { emoji, users, count, reacted };
    })
    .filter((entry): entry is DMReaction => Boolean(entry));
}

export function normalizeDmMessageType(raw: unknown): 'user' | 'system' {
  const message = asRecord(raw);
  return (message.message_type ?? message.messageType) === 'system' ? 'system' : 'user';
}

export function normalizeDmSystemType(raw: unknown): string | null {
  const message = asRecord(raw);
  const value = message.system_type ?? message.systemType;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeDmSystemData(raw: unknown): Record<string, unknown> | null {
  const message = asRecord(raw);
  const value = message.system_data ?? message.systemData;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeDmSystemText(raw: unknown): string {
  const message = asRecord(raw);
  const value = message.system_text ?? message.systemText ?? message.content ?? message.text;
  return typeof value === 'string' ? value : '';
}

export function normalizeDmServerAttachments(raw: unknown): MessageAttachment[] | null {
  const list = asRecord(raw).attachments;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((entry: unknown) => {
    const a = asRecord(entry);
    const type = typeof a.type === 'string' ? a.type : null;
    const thumbnailUrl = typeof a.thumbnailUrl === 'string' ? a.thumbnailUrl : null;
    const thumbnail_url = typeof a.thumbnail_url === 'string' ? a.thumbnail_url : null;
    return {
      url: typeof a.url === 'string' ? a.url : '',
      type,
      mime: type,
      size: typeof a.size === 'number' ? a.size : null,
      name: typeof a.name === 'string' ? a.name : null,
      thumbnailUrl: thumbnailUrl ?? thumbnail_url,
      thumbnail_url: thumbnail_url ?? thumbnailUrl,
    };
  });
}

export function normalizeDmNsfwTags(raw: unknown): string[] {
  const message = asRecord(raw);
  const value = message.nsfw_tags ?? message.nsfwTags;
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export async function decodeDmMessageText(raw: unknown, syncKey: string | null, conversationId: string): Promise<string> {
  if (normalizeDmMessageType(raw) === 'system') {
    return normalizeDmSystemText(raw);
  }
  if (!syncKey) {
    throw new Error('No sync key available');
  }
  const message = asRecord(raw);
  const encryptedPayload = message.encrypted_payload ?? message.encryptedPayload;
  if (typeof encryptedPayload !== 'string' || !encryptedPayload) return '';
  if (getDMPayloadVersion(encryptedPayload) === 2) {
    const payload = JSON.parse(encryptedPayload) as { kid: number };
    const secret = await loadConversationSecretForCurrentDevice(conversationId, payload.kid);
    if (!secret) throw new Error('No v2 DM key available for this device');
    return decryptDMV2(encryptedPayload, secret, conversationId);
  }
  return decryptDM(encryptedPayload, syncKey, conversationId);
}
