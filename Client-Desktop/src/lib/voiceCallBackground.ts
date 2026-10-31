import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { CSSProperties } from 'react';
import type { VoiceBgPattern, VoiceBgScene } from '../stores/settingsStore';

/**
 * Server voice call background customization.
 *
 * Pattern backgrounds are pure CSS built from 1-6 hex colors. Uploaded
 * image/video backgrounds are stored locally in IndexedDB — they never leave
 * this device and are not synced to any account or server.
 */

export const DEFAULT_VOICE_BG_CSS =
  'radial-gradient(circle at 20% 0%, #3a418f 0%, #23274f 45%, #16182d 100%)';

/** Builds the CSS background for the given colors + pattern. */
export function buildVoiceBackgroundCss(colors: string[], pattern: VoiceBgPattern): string {
  const list = colors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  if (list.length === 0) return DEFAULT_VOICE_BG_CSS;
  if (list.length === 1) return list[0];

  const stops = list
    .map((c, i) => `${c} ${Math.round((i / (list.length - 1)) * 100)}%`)
    .join(', ');

  switch (pattern) {
    case 'linear':
      return `linear-gradient(180deg, ${stops})`;
    case 'diagonal':
      return `linear-gradient(135deg, ${stops})`;
    case 'stripes': {
      const bands = list
        .map((c, i) => `${c} ${i * STRIPE_BAND_PX}px ${(i + 1) * STRIPE_BAND_PX}px`)
        .join(', ');
      return `repeating-linear-gradient(45deg, ${bands})`;
    }
    case 'mesh': {
      // Soft color blobs anchored around the edges over a base of the last color.
      const anchors = [
        '15% 10%', '85% 15%', '20% 85%', '80% 80%', '50% 40%', '50% 95%',
      ];
      const blobs = list
        .slice(0, anchors.length)
        .map((c, i) => `radial-gradient(circle at ${anchors[i]}, ${c} 0%, transparent 55%)`)
        .join(', ');
      return `${blobs}, ${list[list.length - 1]}`;
    }
    case 'radial':
    default:
      return `radial-gradient(circle at 20% 0%, ${stops})`;
  }
}

/**
 * Ready-made color schemes for the voice background (names are proper nouns).
 * `scene` is the preset's signature decorative effect (e.g. the 360-style
 * rings for Xbox); users can re-mix any scene with any colors afterwards.
 */
export const VOICE_BG_PRESETS: { id: string; name: string; colors: string[]; scene?: VoiceBgScene }[] = [
  { id: 'default-blue', name: 'Default Blue', colors: ['#3a418f', '#23274f', '#16182d'] },
  { id: 'dark-cat', name: 'DarkCat', colors: ['#7c3aed', '#4c1d95', '#1e1b4b'], scene: 'particles' },
  { id: 'angel-cat', name: 'AngelCat', colors: ['#f9a8d4', '#c084fc', '#818cf8'], scene: 'particles' },
  { id: 'midnight-cat', name: 'MidnightCat', colors: ['#334155', '#1e293b', '#0f172a'] },
  { id: 'retro-discord', name: 'RetroDiscord', colors: ['#7289da', '#424549', '#282b30'] },
  { id: 'playstation', name: 'PlayStation', colors: ['#0070d1', '#003791', '#0a0a23'], scene: 'particles' },
  { id: 'xbox', name: 'Xbox', colors: ['#9bf00b', '#107c10', '#0b0b0b'], scene: 'rings' },
  { id: 'steam', name: 'Steam', colors: ['#66c0f4', '#2a475e', '#1b2838', '#171a21'], scene: 'orbit' },
  { id: 'roblox', name: 'Roblox', colors: ['#e2231a', '#393b3d', '#1b1b1b'], scene: 'pixels' },
  { id: 'minecraft', name: 'Minecraft', colors: ['#57a64e', '#825432', '#31241a'], scene: 'pixels' },
  { id: 'fortnite', name: 'Fortnite', colors: ['#00c3ff', '#7b68ee', '#1a1048'], scene: 'particles' },
  { id: 'terraria', name: 'Terraria', colors: ['#87ceeb', '#3f7a2f', '#4a3524'], scene: 'pixels' },
];

const STRIPE_BAND_PX = 56;

/**
 * Animation className/style for a pattern (used when "Animated pattern" is on).
 * Keyframes live in index.css; system reduced-motion disables them there.
 * - pan: gradient drifts via oversized background-size + position sweep
 * - scroll: stripes slide along their 45° axis; the CSS var is one exact
 *   repeat period so the loop is seamless
 * - mesh: the layer itself slowly rotates (must be oversized, see CSS)
 */
export function getVoiceBackgroundAnimation(
  colors: string[],
  pattern: VoiceBgPattern,
): { className: string; style: CSSProperties } {
  const count = Math.max(colors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).length, 1);
  if (count < 2) return { className: '', style: {} };
  switch (pattern) {
    case 'stripes': {
      // Repeat period along the 45° axis is count*BAND px; a background-position
      // shift of (a, a) travels a*sqrt(2) along that axis, so a = period/sqrt(2).
      // Multiply up so one 18s loop covers several periods.
      const shift = (count * STRIPE_BAND_PX * Math.SQRT1_2 * 4).toFixed(2);
      return {
        className: 'voice-bg-animated-scroll',
        style: { '--voice-bg-scroll': `${shift}px` } as CSSProperties,
      };
    }
    case 'mesh':
      return { className: 'voice-bg-animated-mesh', style: {} };
    default:
      return { className: 'voice-bg-animated-pan', style: {} };
  }
}

// ── Local file storage (IndexedDB) ─────────────────────────────────────────

export type StoredVoiceBackground = {
  blob: Blob;
  type: string; // mime type; video/* renders as a looping <video>
  name: string;
};

interface VoiceBgDatabase extends DBSchema {
  files: {
    key: string;
    value: StoredVoiceBackground;
  };
}

const DB_NAME = 'catrealm-voice-bg';
const FILE_KEY = 'background';

let dbPromise: Promise<IDBPDatabase<VoiceBgDatabase>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<VoiceBgDatabase>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('files');
      },
    });
  }
  return dbPromise;
}

export async function saveVoiceBackgroundFile(file: File): Promise<void> {
  const db = await getDB();
  await db.put('files', { blob: file, type: file.type, name: file.name }, FILE_KEY);
}

export async function loadVoiceBackgroundFile(): Promise<StoredVoiceBackground | null> {
  try {
    const db = await getDB();
    return (await db.get('files', FILE_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function clearVoiceBackgroundFile(): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('files', FILE_KEY);
  } catch {
    // Nothing to clear or storage unavailable; the mode falls back to default.
  }
}

export function isVideoBackground(type: string) {
  return type.startsWith('video/');
}

/** Accepted upload types: stills, animated images, and looping videos. */
export const VOICE_BG_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/apng,video/mp4,video/webm';
