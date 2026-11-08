import type { MessageAttachment, SafetyArtifactVisibility } from '../types';

export type ReportableSafetyArtifact = {
  key: string;
  kind: 'image' | 'link';
  label: string;
  evidence: Record<string, unknown>;
};

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

function normalizedUrl(value: string): string | null {
  const candidate = value.replace(/[),.!?\]}]+$/g, '');
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return null;
  }
}

export function reportableSafetyArtifacts(text: string, attachments?: MessageAttachment[] | null): ReportableSafetyArtifact[] {
  const artifacts: ReportableSafetyArtifact[] = [];
  (attachments ?? []).forEach((attachment, index) => {
    const mime = attachment.mime ?? attachment.type ?? '';
    if (!mime.startsWith('image/')) return;
    artifacts.push({
      key: `attachment:${index}`,
      kind: 'image',
      label: attachment.name ? `Image: ${attachment.name}` : `Image ${index + 1}`,
      evidence: {
        attachmentIndex: index,
        attachmentUrl: typeof attachment.url === 'string' ? attachment.url.split('?')[0] : null,
        attachmentType: mime,
        attachmentName: attachment.name ?? null,
      },
    });
  });
  const seen = new Set<string>();
  for (const raw of String(text || '').match(URL_RE) ?? []) {
    const url = normalizedUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    artifacts.push({ key: `link:${url}`.slice(0, 512), kind: 'link', label: url, evidence: { selectedUrl: url } });
  }
  return artifacts;
}

export function hiddenSafetyArtifactKeys(artifacts?: SafetyArtifactVisibility[] | null): Set<string> {
  return new Set((artifacts ?? [])
    .filter((artifact) => artifact.hiddenForUser || artifact.state === 'quarantined' || artifact.state === 'removed')
    .map((artifact) => artifact.artifactKey));
}

export function hideSafetyLinks(text: string, hidden: ReadonlySet<string>): string {
  return String(text || '').replace(URL_RE, (raw) => {
    const url = normalizedUrl(raw);
    return url && hidden.has(`link:${url}`.slice(0, 512)) ? '[Hidden—reported for safety]' : raw;
  });
}

export function hideSafetyAttachments(attachments: MessageAttachment[] | null | undefined, hidden: ReadonlySet<string>): MessageAttachment[] | null {
  if (!attachments?.length) return null;
  const visible = attachments.filter((_attachment, index) => !hidden.has(`attachment:${index}`));
  return visible.length ? visible : null;
}
