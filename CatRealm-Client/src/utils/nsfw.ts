export interface NsfwPreferenceState {
  allowNsfw: boolean;
  nsfwLewds: boolean;
  nsfwBlood: boolean;
  nsfwGore: boolean;
}

export function normalizeNsfwTags(tags?: string[] | null): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.toLowerCase().trim())
    .filter(Boolean);
}

export function shouldBlurAttachmentForNsfwTags(
  tags: string[] | undefined | null,
  prefs: NsfwPreferenceState
): boolean {
  const normalizedTags = normalizeNsfwTags(tags);
  if (normalizedTags.length === 0) return false;

  // Spoilers always blur regardless of NSFW preferences
  if (normalizedTags.includes('spoiler')) return true;

  if (!prefs.allowNsfw) return true;

  const hasLewd = normalizedTags.some((tag) => tag === 'lewd' || tag === 'sexual');
  const hasBlood = normalizedTags.includes('blood');
  const hasGore = normalizedTags.some((tag) => tag === 'gore' || tag === 'violence' || tag === 'disturbing');

  if (hasLewd && !prefs.nsfwLewds) return true;
  if (hasBlood && !prefs.nsfwBlood) return true;
  if (hasGore && !prefs.nsfwGore) return true;

  return false;
}

export function getNsfwSubtagLabels(tags: string[] | undefined | null): string[] {
  const normalizedTags = normalizeNsfwTags(tags);
  const labels: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (label: string) => {
    if (seen.has(label)) return;
    seen.add(label);
    labels.push(label);
  };

  for (const tag of normalizedTags) {
    if (tag === 'spoiler') {
      pushUnique('Spoiler');
      continue;
    }
    if (tag === 'lewd' || tag === 'sexual') {
      pushUnique('Lewd');
      continue;
    }
    if (tag === 'blood') {
      pushUnique('Blood');
      continue;
    }
    if (tag === 'gore' || tag === 'violence' || tag === 'disturbing') {
      pushUnique('Gore');
      continue;
    }

    const fallback = tag
      .split(/[_\s-]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    if (fallback) pushUnique(fallback);
  }

  return labels;
}
