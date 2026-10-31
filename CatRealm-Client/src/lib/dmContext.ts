export type DMParsedContextText = {
  kind: 'reply' | 'forward';
  authorLabel: string;
  previewText: string;
  messageId?: string;
  bodyText: string;
  source: 'legacy' | 'structured';
};

export type DMStructuredContextEnvelope = {
  v: 1;
  kind: 'reply' | 'forward';
  authorLabel: string;
  previewText: string;
  messageId?: string;
};

function encodeDmContextEnvelope(meta: DMStructuredContextEnvelope): string {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(meta))));
  } catch {
    return '';
  }
}

// A preview cut from a message that was itself a reply holds a truncated envelope; never show that raw.
function cleanPreviewText(value: unknown): string {
  const text = String(value || '').trim();
  if (text.startsWith('[[crdmctx:')) return '(message)';
  return text || '(attachment)';
}

/** Text to quote when replying to or forwarding a DM: the source's own reply/forward envelope removed. */
export function dmContextPreviewText(sourceText: string | null | undefined): string {
  const raw = String(sourceText || '').trim();
  const body = (parseDmContextText(raw)?.bodyText ?? raw).replace(/\s+/g, ' ').trim();
  return body ? body.slice(0, 160) : '(attachment)';
}

function decodeDmContextEnvelope(value: string): DMStructuredContextEnvelope | null {
  try {
    const decoded = decodeURIComponent(escape(atob(value)));
    const parsed = JSON.parse(decoded);
    if (!parsed || parsed.v !== 1) return null;
    if (parsed.kind !== 'reply' && parsed.kind !== 'forward') return null;
    return {
      v: 1,
      kind: parsed.kind,
      authorLabel: String(parsed.authorLabel || '').trim(),
      previewText: cleanPreviewText(parsed.previewText),
      ...(typeof parsed.messageId === 'string' && parsed.messageId ? { messageId: parsed.messageId } : {}),
    };
  } catch {
    return null;
  }
}

export function buildDmContextText(meta: DMStructuredContextEnvelope, bodyText: string): string {
  const encoded = encodeDmContextEnvelope(meta);
  const trimmedBody = String(bodyText || '').trim();
  if (!encoded) {
    const legacyPrefix = meta.kind === 'reply'
      ? `> Replying to ${meta.authorLabel}: ${meta.previewText}`
      : `[Forwarded from ${meta.authorLabel}] ${meta.previewText}`;
    return `${legacyPrefix}${trimmedBody ? `\n${trimmedBody}` : ''}`.trim();
  }
  return `[[crdmctx:${encoded}]]${trimmedBody ? `\n${trimmedBody}` : ''}`;
}

export function parseDmContextText(text: string): DMParsedContextText | null {
  const raw = String(text || '');
  if (!raw) return null;

  const structuredMatch = raw.match(/^\[\[crdmctx:([A-Za-z0-9+/=]+)\]\](?:\n([\s\S]*))?$/);
  if (structuredMatch) {
    const meta = decodeDmContextEnvelope(structuredMatch[1]);
    if (meta) {
      return {
        kind: meta.kind,
        authorLabel: meta.authorLabel,
        previewText: meta.previewText,
        messageId: meta.messageId,
        bodyText: (structuredMatch[2] || '').trim(),
        source: 'structured',
      };
    }
  }

  const replyMatch = raw.match(/^> Replying to (.+?): ([^\n]*)(?:\n([\s\S]*))?$/);
  if (replyMatch) {
    return {
      kind: 'reply',
      authorLabel: replyMatch[1].trim(),
      previewText: (replyMatch[2] || '').trim() || '(attachment)',
      bodyText: (replyMatch[3] || '').trim(),
      source: 'legacy',
    };
  }

  const forwardMatch = raw.match(/^\[Forwarded from (.+?)\] ([^\n]*)(?:\n([\s\S]*))?$/);
  if (forwardMatch) {
    return {
      kind: 'forward',
      authorLabel: forwardMatch[1].trim(),
      previewText: (forwardMatch[2] || '').trim() || '(attachment)',
      bodyText: (forwardMatch[3] || '').trim(),
      source: 'legacy',
    };
  }

  return null;
}
