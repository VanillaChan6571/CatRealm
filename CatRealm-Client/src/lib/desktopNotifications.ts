import { parseDmContextText } from './dmContext';

export type DesktopNotificationTarget = {
  id: string;
  sourceKind: 'dm' | 'server';
  sourceId: string;
  subsourceId?: string;
};

export type DesktopNotificationRequest = DesktopNotificationTarget & {
  title: string;
  body: string;
  iconUrl?: string;
};

export function isAppInBackground(): boolean {
  return typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
}

export function showDesktopNotification(notification: DesktopNotificationRequest): void {
  if (!isAppInBackground()) return;
  if (!window.electron?.showDesktopNotification) return;
  void window.electron.showDesktopNotification(notification).catch(() => {});
}

export function dismissDesktopNotifications(sourceKind: DesktopNotificationTarget['sourceKind'], sourceId: string, subsourceId?: string): void {
  void window.electron?.dismissDesktopNotifications?.({ sourceKind, sourceId, subsourceId }).catch(() => {});
}

export const DM_NOTIFICATION_FALLBACK_BODY = 'Sent you a message';
export const SERVER_NOTIFICATION_FALLBACK_BODY = 'Sent a message';
const DM_PREVIEW_WAIT_MS = 1500;
const PREVIEW_MAX_LENGTH = 200;

// Same shapes MessageFormatter parses: :name: / :origin:sticker:name:owner:
// emote tokens, <?imgN> inline-attachment slots, and ||spoiler|| text.
const EMOTE_TOKEN_REGEX = /:(https?:\/\/[^\s:]+(?::\d{1,5})?):(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:|:(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:/gi;
const INLINE_IMAGE_TOKEN_REGEX = /<\?img\d+>/gi;
const SPOILER_REGEX = /\|\|[\s\S]+?\|\|/g;

type MessagePreviewSource = {
  text?: string | null;
  attachmentType?: string | null;
  attachments?: Array<{ type?: string | null; mime?: string | null }> | null;
};

/**
 * Message text for a toast: emotes shortened to :name:, spoilers hidden,
 * inline image slots dropped. Attachment-only messages get a short label.
 */
export function messageNotificationPreview(message: MessagePreviewSource, fallback: string): string {
  // DM replies carry a [[crdmctx:…]] envelope ahead of the reply text.
  const raw = message.text ? parseDmContextText(message.text)?.bodyText ?? message.text : message.text;
  const text = raw
    ?.replace(SPOILER_REGEX, '[spoiler]')
    .replace(EMOTE_TOKEN_REGEX, (_match, _origin, _sticker, originName, _owner, _sticker2, plainName) => `:${originName || plainName}:`)
    .replace(INLINE_IMAGE_TOKEN_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text) return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH - 1)}…` : text;
  const types = [message.attachmentType, ...(message.attachments ?? []).map((a) => a.mime ?? a.type)];
  if (types.some((type) => type?.startsWith('image'))) return 'Sent an image';
  if (types.some((type) => type?.startsWith('video'))) return 'Sent a video';
  if (types.some(Boolean)) return 'Sent an attachment';
  return fallback;
}

/** Decrypted DM text for a toast, or a short label for attachment-only messages. */
export function dmNotificationPreview(message: MessagePreviewSource): string {
  return messageNotificationPreview(message, DM_NOTIFICATION_FALLBACK_BODY);
}

// notification:new arrives before dm:message has been decrypted, so DM toasts
// wait briefly for the plaintext and fall back to the generic body.
const heldDMNotifications = new Map<string, { request: DesktopNotificationRequest; timer: ReturnType<typeof setTimeout> }>();

export function holdDMNotification(messageId: string, request: DesktopNotificationRequest): void {
  if (heldDMNotifications.has(messageId)) return;
  const timer = setTimeout(() => releaseDMNotification(messageId, null), DM_PREVIEW_WAIT_MS);
  heldDMNotifications.set(messageId, { request, timer });
}

export function releaseDMNotification(messageId: string, preview: string | null): void {
  const held = heldDMNotifications.get(messageId);
  if (!held) return;
  heldDMNotifications.delete(messageId);
  clearTimeout(held.timer);
  showDesktopNotification(preview ? { ...held.request, body: preview } : held.request);
}
