import { describe, it, expect } from 'vitest';
import { buildDmContextText, dmContextPreviewText, parseDmContextText, type DMStructuredContextEnvelope } from '../dmContext';

describe('buildDmContextText / parseDmContextText round-trip', () => {
  it('round-trips a reply context', () => {
    const meta: DMStructuredContextEnvelope = {
      v: 1,
      kind: 'reply',
      authorLabel: 'Alice',
      previewText: 'Hello there!',
      messageId: 'original-message',
    };
    const built = buildDmContextText(meta, 'My response');
    expect(built).toBeTruthy();

    const parsed = parseDmContextText(built);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('reply');
    expect(parsed!.authorLabel).toBe('Alice');
    expect(parsed!.previewText).toBe('Hello there!');
    expect(parsed!.messageId).toBe('original-message');
    expect(parsed!.bodyText).toBe('My response');
    expect(parsed!.source).toBe('structured');
  });

  it('round-trips a forward context', () => {
    const meta: DMStructuredContextEnvelope = {
      v: 1,
      kind: 'forward',
      authorLabel: 'Bob',
      previewText: 'Check this out',
    };
    const built = buildDmContextText(meta, '');
    const parsed = parseDmContextText(built);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('forward');
    expect(parsed!.authorLabel).toBe('Bob');
    expect(parsed!.bodyText).toBe('');
  });

  it('round-trips with empty body', () => {
    const meta: DMStructuredContextEnvelope = {
      v: 1,
      kind: 'reply',
      authorLabel: 'User',
      previewText: '(attachment)',
    };
    const built = buildDmContextText(meta, '');
    const parsed = parseDmContextText(built);
    expect(parsed!.bodyText).toBe('');
  });
});

describe('parseDmContextText legacy format', () => {
  it('parses a legacy reply', () => {
    const text = '> Replying to Alice: Hello\nMy response';
    const parsed = parseDmContextText(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('reply');
    expect(parsed!.authorLabel).toBe('Alice');
    expect(parsed!.previewText).toBe('Hello');
    expect(parsed!.bodyText).toBe('My response');
    expect(parsed!.source).toBe('legacy');
  });

  it('parses a legacy forward', () => {
    const text = '[Forwarded from Bob] Check this out';
    const parsed = parseDmContextText(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('forward');
    expect(parsed!.authorLabel).toBe('Bob');
    expect(parsed!.previewText).toBe('Check this out');
    expect(parsed!.bodyText).toBe('');
    expect(parsed!.source).toBe('legacy');
  });

  it('returns null for plain text', () => {
    expect(parseDmContextText('just a normal message')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDmContextText('')).toBeNull();
  });
});

describe('replying to a reply', () => {
  const firstReply = buildDmContextText({ v: 1, kind: 'reply', authorLabel: 'Alesya', previewText: 'its interesting though' }, 'sometimes they look good');

  it('quotes only the body, not the nested envelope', () => {
    expect(dmContextPreviewText(firstReply)).toBe('sometimes they look good');
    const parsed = parseDmContextText(buildDmContextText({ v: 1, kind: 'reply', authorLabel: 'Alesya', previewText: dmContextPreviewText(firstReply) }, 'like unnatural'));
    expect(parsed!.previewText).toBe('sometimes they look good');
  });

  it('falls back to (attachment) for a body-less message', () => {
    expect(dmContextPreviewText('')).toBe('(attachment)');
    expect(dmContextPreviewText(buildDmContextText({ v: 1, kind: 'reply', authorLabel: 'A', previewText: 'x' }, ''))).toBe('(attachment)');
  });

  it('hides truncated envelopes already stored in old previews', () => {
    const broken = buildDmContextText({ v: 1, kind: 'reply', authorLabel: 'Alesya', previewText: firstReply.slice(0, 160) }, 'wtf');
    expect(parseDmContextText(broken)!.previewText).toBe('(message)');
  });
});
