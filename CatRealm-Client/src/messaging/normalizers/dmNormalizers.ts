import type { DMReaction, MessageAttachment } from '../../types';
import { decryptDM, decryptDMV2, getDMPayloadVersion } from '../crypto/dmCrypto';
import { loadConversationSecretForCurrentDevice } from '../crypto/dmKeyStore';

export function normalizeDmReactions(reactions: unknown, userId: string | undefined): DMReaction[] {
  if (!Array.isArray(reactions)) return [];
  return reactions
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const emoji = typeof (entry as any).emoji === 'string' ? (entry as any).emoji : '';
      if (!emoji) return null;
      const users = Array.isArray((entry as any).users)
        ? (entry as any).users.filter((u: unknown): u is string => typeof u === 'string')
        : [];
      const count = typeof (entry as any).count === 'number' ? (entry as any).count : users.length;
      // Central's socket fan-out carries `reacted` computed for whoever reacted, so derive our
      // own state from `users` whenever we can and only trust the flag as a fallback.
      const reacted = userId && Array.isArray((entry as any).users)
        ? users.includes(userId)
        : (entry as any).reacted === true;
      return { emoji, users, count, reacted };
    })
    .filter((entry): entry is DMReaction => Boolean(entry));
}

export function normalizeDmMessageType(raw: any): 'user' | 'system' {
  return (raw?.message_type ?? raw?.messageType) === 'system' ? 'system' : 'user';
}

export function normalizeDmSystemType(raw: any): string | null {
  const value = raw?.system_type ?? raw?.systemType;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeDmSystemData(raw: any): Record<string, unknown> | null {
  const value = raw?.system_data ?? raw?.systemData;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeDmSystemText(raw: any): string {
  const value = raw?.system_text ?? raw?.systemText ?? raw?.content ?? raw?.text;
  return typeof value === 'string' ? value : '';
}

export function normalizeDmServerAttachments(raw: any): MessageAttachment[] | null {
  const list = raw?.attachments;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((a: any) => ({
    url: a.url ?? '',
    type: a.type ?? null,
    mime: a.type ?? null,
    size: typeof a.size === 'number' ? a.size : null,
    name: a.name ?? null,
    thumbnailUrl: a.thumbnailUrl ?? a.thumbnail_url ?? null,
    thumbnail_url: a.thumbnail_url ?? a.thumbnailUrl ?? null,
  }));
}

export function normalizeDmNsfwTags(raw: any): string[] {
  const value = raw?.nsfw_tags ?? raw?.nsfwTags;
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export async function decodeDmMessageText(raw: any, syncKey: string | null, conversationId: string): Promise<string> {
  if (normalizeDmMessageType(raw) === 'system') {
    return normalizeDmSystemText(raw);
  }
  if (!syncKey) {
    throw new Error('No sync key available');
  }
  const encryptedPayload = raw?.encrypted_payload ?? raw?.encryptedPayload;
  if (typeof encryptedPayload !== 'string' || !encryptedPayload) return '';
  if (getDMPayloadVersion(encryptedPayload) === 2) {
    const payload = JSON.parse(encryptedPayload) as { kid: number };
    const secret = await loadConversationSecretForCurrentDevice(conversationId, payload.kid);
    if (!secret) throw new Error('No v2 DM key available for this device');
    return decryptDMV2(encryptedPayload, secret, conversationId);
  }
  return decryptDM(encryptedPayload, syncKey, conversationId);
}
