import manifest from './packs.json';
import type { PackLanguage, TranslationLanguage } from './languages';

/**
 * Language-pack model files — the same packs.json as the desktop client (copied from
 * CatRealm-Client/src/lib/translation; keep them in sync), mirrored to catrealm.app/lang/. Spanish models are
 * Bergamot's (University of Edinburgh, CC-BY-SA-4.0); Russian and Japanese are Mozilla's
 * Firefox Translations models (MPL-2.0). Hashes are pinned so a tampered or truncated download
 * is rejected before it reaches the WASM engine, and a changed hash is how a pack gets an update.
 */
export type ModelFile = { url: string; sha256: string; size: number };
export type PairFiles = { model: ModelFile; lex: ModelFile; vocabs: ModelFile[] };

type ManifestFile = { role: string; name: string; sha256: string; size: number };
type ManifestPack = { lang: string; revision: number; pairs: Record<string, ManifestFile[]> };

// JSON imports infer each pack's pairs as its own literal shape; packs.json is generated with this layout.
const packs = new Map((manifest.packs as unknown as ManifestPack[]).map((pack) => [pack.lang, pack]));

function toModelFile(pack: ManifestPack, file: ManifestFile): ModelFile {
  return { url: `${manifest.baseUrl}/${pack.lang}/${pack.revision}/${file.name}`, sha256: file.sha256, size: file.size };
}

/** Files for one direct direction; one side is always English. */
export function pairFiles(from: TranslationLanguage, to: TranslationLanguage): PairFiles | null {
  if (from !== 'en' && to !== 'en') return null;
  const pack = packs.get(from === 'en' ? to : from);
  const files = pack?.pairs[`${from}-${to}`];
  if (!pack || !files) return null;
  const byRole = (role: string) => files.filter((file) => file.role === role).map((file) => toModelFile(pack, file));
  const [model] = byRole('model');
  const [lex] = byRole('lex');
  // Most pairs share one vocab; some (en→ja) have separate source and target vocabs.
  const vocabs = [...byRole('vocab'), ...byRole('srcvocab'), ...byRole('trgvocab')];
  return model && lex && vocabs.length ? { model, lex, vocabs } : null;
}

/** Unique files across both directions of a pack. */
export function packFiles(lang: PackLanguage): ModelFile[] {
  const pack = packs.get(lang);
  if (!pack) return [];
  const bySha = new Map<string, ModelFile>();
  for (const files of Object.values(pack.pairs)) {
    for (const file of files) bySha.set(file.sha256, toModelFile(pack, file));
  }
  return [...bySha.values()];
}

/** Bytes stored on disk once a pack is installed. */
export function packBytes(lang: PackLanguage): number {
  return packFiles(lang).reduce((sum, file) => sum + file.size, 0);
}
