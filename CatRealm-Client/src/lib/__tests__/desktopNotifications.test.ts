import { buildDmContextText } from '../dmContext';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DM_NOTIFICATION_FALLBACK_BODY,
  dmNotificationPreview,
  holdDMNotification,
  messageNotificationPreview,
  releaseDMNotification,
  SERVER_NOTIFICATION_FALLBACK_BODY,
} from '../desktopNotifications';

const request = { id: 'n1', sourceKind: 'dm' as const, sourceId: 'dm-1', title: 'Kitty', body: DM_NOTIFICATION_FALLBACK_BODY };

describe('dmNotificationPreview', () => {
  it('uses the decrypted text, collapsed and trimmed', () => {
    expect(dmNotificationPreview({ text: '  meow\n\n meow  ' })).toBe('meow meow');
  });

  it('shows only the reply text, not the reply envelope', () => {
    const reply = buildDmContextText({ v: 1, kind: 'reply', authorLabel: 'Aydan', previewText: 'earlier message' }, 'sounds good');
    expect(dmNotificationPreview({ text: reply })).toBe('sounds good');
  });

  it('truncates long messages', () => {
    const preview = dmNotificationPreview({ text: 'a'.repeat(500) });
    expect(preview).toHaveLength(200);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('labels attachment-only messages', () => {
    expect(dmNotificationPreview({ text: '', attachments: [{ mime: 'image/png' }] })).toBe('Sent an image');
    expect(dmNotificationPreview({ text: '', attachmentType: 'application/pdf' })).toBe('Sent an attachment');
    expect(dmNotificationPreview({ text: '' })).toBe(DM_NOTIFICATION_FALLBACK_BODY);
  });
});

describe('messageNotificationPreview', () => {
  it('hides spoilers', () => {
    expect(messageNotificationPreview({ text: 'the cat is ||actually a dog|| lol' }, SERVER_NOTIFICATION_FALLBACK_BODY))
      .toBe('the cat is [spoiler] lol');
  });

  it('shortens emote tokens to their name', () => {
    expect(messageNotificationPreview({ text: 'hi :wave: and :https://realm.example:443:sticker:nyan:owner123:' }, SERVER_NOTIFICATION_FALLBACK_BODY))
      .toBe('hi :wave: and :nyan:');
  });

  it('drops inline image slots and labels what is left', () => {
    expect(messageNotificationPreview({ text: 'look <?img0>' }, SERVER_NOTIFICATION_FALLBACK_BODY)).toBe('look');
    expect(messageNotificationPreview({ text: '<?img0>', attachments: [{ mime: 'video/mp4' }] }, SERVER_NOTIFICATION_FALLBACK_BODY))
      .toBe('Sent a video');
    expect(messageNotificationPreview({ text: '' }, SERVER_NOTIFICATION_FALLBACK_BODY)).toBe(SERVER_NOTIFICATION_FALLBACK_BODY);
  });
});

describe('held DM notifications', () => {
  const show = vi.fn(() => Promise.resolve({ ok: true }));

  beforeEach(() => {
    vi.useFakeTimers();
    show.mockClear();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    (window as unknown as { electron: unknown }).electron = { showDesktopNotification: show };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as unknown as { electron?: unknown }).electron;
  });

  it('shows the decrypted preview once the message is released', () => {
    holdDMNotification('m1', request);
    expect(show).not.toHaveBeenCalled();
    releaseDMNotification('m1', 'hello there');
    expect(show).toHaveBeenCalledWith({ ...request, body: 'hello there' });
    vi.advanceTimersByTime(5000);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic body when the message never decrypts', () => {
    holdDMNotification('m2', request);
    vi.advanceTimersByTime(1500);
    expect(show).toHaveBeenCalledWith(request);
    releaseDMNotification('m2', 'too late');
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('ignores releases for messages that were never held', () => {
    releaseDMNotification('unknown', 'hi');
    expect(show).not.toHaveBeenCalled();
  });
});
