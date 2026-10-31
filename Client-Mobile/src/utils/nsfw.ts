export interface NsfwPrefs {
  allowNsfw: boolean;
  nsfwLewds: boolean;
  nsfwBlood: boolean;
  nsfwGore: boolean;
}

export function normalizeNsfwTags(tags?: string[] | null): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => t.toLowerCase().trim()).filter(Boolean);
}

export function shouldBlurForNsfwTags(tags: string[] | undefined | null, prefs: NsfwPrefs): boolean {
  const t = normalizeNsfwTags(tags);
  if (t.length === 0) return false;
  if (t.includes('spoiler')) return true;
  if (!prefs.allowNsfw) return true;
  if (t.some((x) => x === 'lewd' || x === 'sexual') && !prefs.nsfwLewds) return true;
  if (t.includes('blood') && !prefs.nsfwBlood) return true;
  if (t.some((x) => x === 'gore' || x === 'violence' || x === 'disturbing') && !prefs.nsfwGore) return true;
  return false;
}

export function getNsfwSubtagLabels(tags: string[] | undefined | null): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const tag of normalizeNsfwTags(tags)) {
    let label: string;
    if (tag === 'spoiler') label = 'Spoiler';
    else if (tag === 'lewd' || tag === 'sexual') label = 'Lewd';
    else if (tag === 'blood') label = 'Blood';
    else if (tag === 'gore' || tag === 'violence' || tag === 'disturbing') label = 'Gore';
    else label = tag.split(/[_\s-]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    if (label && !seen.has(label)) { seen.add(label); labels.push(label); }
  }
  return labels;
}
