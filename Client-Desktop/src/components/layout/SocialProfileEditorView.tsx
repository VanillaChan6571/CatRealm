import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { ArrowLeft, Award, Camera, Gamepad2, ImagePlus, Images, Palette, Pencil, Save, ShieldCheck, Trash2, Wand2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAuthStore } from '../../stores/authStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { useServerStore } from '../../stores/serverStore';
import { createApi } from '../../lib/api';
import { AUTH_BASE, createAuthenticatedApi } from '../../lib/authApi';
import { openExternalUrl } from '../../utils/externalLinks';
import { resolveAvatarUrl } from '../../utils/avatar';
import {
  backgroundForBadgeImage,
  imageForProfileBadge,
  imageForYearBadge,
  ProfileBadges,
  type ProfileBadgeShowcase,
  yearBadgeTier,
} from '../profile/ProfileBadges';
import type { Profile } from '../../types';
import type { SocialProfileConfig } from '../../types';

type SocialProfileEditorViewProps = {
  onBack: () => void;
};

type SocialProfileLink = NonNullable<SocialProfileConfig['links']>[number];
const SOCIAL_PROFILE_LOCAL_CONFIG_PREFIX = 'catrealm:social-profile-config:';

const STREAK_LABELS = ['Online Streak', 'Highest Online Streak'] as const;

type StreakAnimationTier = 'static' | 'subtle' | 'enhanced' | 'elemental' | 'prestige';

type StreakVisual = {
  minDays: number;
  label: string;
  shape: string;
  accent: string;
  tier: StreakAnimationTier;
  motif: 'head' | 'paw' | 'tail' | 'claw' | 'crystal' | 'cosmic' | 'element';
  clipPath?: string;
  radius?: string;
};

const STREAK_VISUALS: StreakVisual[] = [
  { minDays: 0, label: 'Kitten Coin', shape: 'Cat Coin', accent: 'from-slate-400 to-cyan-500', tier: 'static', motif: 'head', radius: '9999px' },
  { minDays: 4, label: 'Neko Hex', shape: 'Eared Hex', accent: 'from-cyan-300 to-blue-500', tier: 'static', motif: 'head', clipPath: 'polygon(18% 20%, 34% 4%, 45% 18%, 55% 18%, 66% 4%, 82% 20%, 96% 54%, 74% 94%, 26% 94%, 4% 54%)' },
  { minDays: 7, label: 'Guardian Cat', shape: 'Eared Shield', accent: 'from-blue-300 to-violet-600', tier: 'static', motif: 'head', clipPath: 'polygon(18% 18%, 34% 0, 48% 18%, 52% 18%, 66% 0, 82% 18%, 88% 66%, 50% 100%, 12% 66%)' },
  { minDays: 14, label: 'Cat Tome', shape: 'Tome', accent: 'from-violet-300 to-fuchsia-600', tier: 'static', motif: 'tail', radius: '8px' },
  { minDays: 21, label: 'Tail Crest', shape: 'Tail Chevron', accent: 'from-fuchsia-300 to-pink-600', tier: 'static', motif: 'tail', clipPath: 'polygon(50% 0, 100% 36%, 82% 100%, 50% 72%, 18% 100%, 0 36%)' },
  { minDays: 30, label: 'Moon Kit', shape: 'Moon Cat', accent: 'from-pink-300 to-rose-600', tier: 'subtle', motif: 'head', radius: '9999px' },
  { minDays: 45, label: 'Scratch Mark', shape: 'Claw Angle', accent: 'from-rose-300 to-orange-500', tier: 'subtle', motif: 'claw', clipPath: 'polygon(12% 18%, 100% 0, 84% 82%, 0 100%)' },
  { minDays: 60, label: 'Tail Banner', shape: 'Tail Flag', accent: 'from-orange-300 to-amber-500', tier: 'subtle', motif: 'tail', clipPath: 'polygon(10% 0, 90% 10%, 76% 48%, 92% 90%, 10% 100%)' },
  { minDays: 90, label: 'Winged Neko', shape: 'Winged Cat', accent: 'from-amber-200 to-yellow-500', tier: 'subtle', motif: 'head', clipPath: 'polygon(50% 0, 98% 22%, 72% 50%, 98% 78%, 50% 100%, 2% 78%, 28% 50%, 2% 22%)' },
  { minDays: 120, label: 'Claw Star', shape: 'Claw Star', accent: 'from-yellow-200 to-lime-500', tier: 'enhanced', motif: 'claw', clipPath: 'polygon(50% 0, 72% 30%, 100% 30%, 78% 52%, 92% 100%, 50% 74%, 8% 100%, 22% 52%, 0 30%, 28% 30%)' },
  { minDays: 180, label: 'Crystal Paw', shape: 'Crystal Paw', accent: 'from-lime-200 to-emerald-500', tier: 'enhanced', motif: 'crystal', clipPath: 'polygon(50% 0, 88% 22%, 74% 100%, 50% 78%, 26% 100%, 12% 22%)' },
  { minDays: 240, label: 'Cosmic Cat', shape: 'Cosmic Cat', accent: 'from-emerald-200 to-cyan-500', tier: 'elemental', motif: 'cosmic', radius: '9999px' },
  { minDays: 300, label: 'Tide Paw', shape: 'Water Paw', accent: 'from-cyan-200 to-sky-600', tier: 'elemental', motif: 'paw', clipPath: 'polygon(50% 0, 84% 44%, 74% 86%, 50% 100%, 26% 86%, 16% 44%)' },
  { minDays: 365, label: 'Flame Cat', shape: 'Fire Cat', accent: 'from-orange-200 to-red-600', tier: 'prestige', motif: 'element', clipPath: 'polygon(50% 0, 68% 28%, 88% 20%, 78% 54%, 94% 72%, 62% 76%, 50% 100%, 38% 76%, 6% 72%, 22% 54%, 12% 20%, 32% 28%)' },
  { minDays: 450, label: 'Forest Paw', shape: 'Earth Paw', accent: 'from-green-200 to-emerald-700', tier: 'prestige', motif: 'paw', clipPath: 'polygon(50% 0, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)' },
  { minDays: 545, label: 'Sky Whisker', shape: 'Air Whisker', accent: 'from-sky-200 to-indigo-500', tier: 'prestige', motif: 'head', clipPath: 'polygon(50% 0, 96% 50%, 50% 100%, 4% 50%)' },
  { minDays: 630, label: 'Geo Neko', shape: 'Geo Cat', accent: 'from-indigo-200 to-purple-600', tier: 'prestige', motif: 'crystal', clipPath: 'polygon(50% 0, 66% 28%, 100% 35%, 76% 60%, 82% 100%, 50% 82%, 18% 100%, 24% 60%, 0 35%, 34% 28%)' },
  { minDays: 730, label: 'Mandala Paw', shape: 'Mandala Paw', accent: 'from-purple-200 to-pink-600', tier: 'prestige', motif: 'paw', radius: '9999px' },
  { minDays: 900, label: 'Astral Neko', shape: 'Astral Cat', accent: 'from-indigo-200 via-violet-500 to-cyan-300', tier: 'prestige', motif: 'cosmic', clipPath: 'polygon(50% 0, 62% 24%, 88% 12%, 76% 38%, 100% 50%, 76% 62%, 88% 88%, 62% 76%, 50% 100%, 38% 76%, 12% 88%, 24% 62%, 0 50%, 24% 38%, 12% 12%, 38% 24%)' },
];

const DEBUG_BADGE_SHOWCASES: ProfileBadgeShowcase[] = [
  ...Array.from({ length: 6 }, (_, index) => {
    const year = index + 1;
    const imageSrc = imageForYearBadge(year) || '';
    return {
      label: `Year ${year}`,
      description: `Year ${year} account age badge.`,
      imageSrc,
      backgroundSrc: backgroundForBadgeImage(imageSrc),
    };
  }),
  {
    label: 'Beta',
    description: 'Beta tester badge.',
    imageSrc: imageForProfileBadge({ id: 'beta', label: 'Beta', icon: 'beta' }) || '',
    backgroundSrc: backgroundForBadgeImage(imageForProfileBadge({ id: 'beta', label: 'Beta', icon: 'beta' })),
  },
  {
    label: 'Staff',
    description: 'CatRealm staff badge.',
    imageSrc: imageForProfileBadge({ id: 'staff', label: 'Staff', icon: 'staff' }) || '',
    backgroundSrc: backgroundForBadgeImage(imageForProfileBadge({ id: 'staff', label: 'Staff', icon: 'staff' })),
  },
  {
    label: 'Supporter',
    description: 'CatRealm supporter badge.',
    imageSrc: imageForProfileBadge({ id: 'supporter', label: 'Supporter', icon: 'supporter' }) || '',
    backgroundSrc: backgroundForBadgeImage(imageForProfileBadge({ id: 'supporter', label: 'Supporter', icon: 'supporter' })),
  },
];

type SocialThemeId = 'amethyst' | 'midnight' | 'sakura' | 'emerald';
type SocialBackgroundId = 'cinematic' | 'glass' | 'clear' | 'moody';
type SocialEffectId = 'none' | 'sparkle' | 'scanline' | 'halo';
type ProfileCompositorMode = 'detecting' | 'browser' | 'd3d11' | 'vulkan' | 'software';

const SOCIAL_THEME_OPTIONS: Array<{
  id: SocialThemeId;
  label: string;
  swatchClass: string;
  rootClass: string;
  pageOverlayClass: string;
  heroGradient: string;
  sectionHeaderClass: string;
  ctaClass: string;
  accentTextClass: string;
}> = [
  {
    id: 'amethyst',
    label: 'Amethyst',
    swatchClass: 'from-violet-500 to-fuchsia-500',
    rootClass: 'bg-[#110a17]',
    pageOverlayClass: 'bg-[linear-gradient(90deg,rgba(5,20,28,0.78),rgba(63,12,47,0.82))]',
    heroGradient: 'linear-gradient(135deg, rgba(19,52,48,0.80), rgba(73,14,50,0.72))',
    sectionHeaderClass: 'bg-gradient-to-r from-cyan-900/70 to-fuchsia-950/70 text-[#dbeafe]',
    ctaClass: 'bg-[#7c3a69] hover:bg-[#8c4478]',
    accentTextClass: 'text-cyan-300',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    swatchClass: 'from-slate-800 to-cyan-500',
    rootClass: 'bg-[#070b14]',
    pageOverlayClass: 'bg-[linear-gradient(90deg,rgba(3,7,18,0.84),rgba(17,24,39,0.86))]',
    heroGradient: 'linear-gradient(135deg, rgba(6,18,31,0.82), rgba(28,34,70,0.74))',
    sectionHeaderClass: 'bg-gradient-to-r from-slate-900/80 to-cyan-950/70 text-cyan-100',
    ctaClass: 'bg-cyan-700 hover:bg-cyan-600',
    accentTextClass: 'text-cyan-200',
  },
  {
    id: 'sakura',
    label: 'Sakura',
    swatchClass: 'from-pink-400 to-rose-500',
    rootClass: 'bg-[#170811]',
    pageOverlayClass: 'bg-[linear-gradient(90deg,rgba(32,7,21,0.82),rgba(76,15,43,0.84))]',
    heroGradient: 'linear-gradient(135deg, rgba(75,18,45,0.80), rgba(132,42,72,0.68))',
    sectionHeaderClass: 'bg-gradient-to-r from-rose-950/75 to-pink-950/70 text-pink-100',
    ctaClass: 'bg-pink-700 hover:bg-pink-600',
    accentTextClass: 'text-pink-200',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    swatchClass: 'from-emerald-500 to-lime-400',
    rootClass: 'bg-[#07140f]',
    pageOverlayClass: 'bg-[linear-gradient(90deg,rgba(4,24,18,0.82),rgba(13,57,45,0.84))]',
    heroGradient: 'linear-gradient(135deg, rgba(10,55,42,0.80), rgba(21,94,71,0.68))',
    sectionHeaderClass: 'bg-gradient-to-r from-emerald-950/75 to-teal-950/70 text-emerald-100',
    ctaClass: 'bg-emerald-700 hover:bg-emerald-600',
    accentTextClass: 'text-emerald-200',
  },
];

const SOCIAL_BACKGROUND_OPTIONS: Array<{
  id: SocialBackgroundId;
  label: string;
  description: string;
  imageClass: string;
}> = [
  { id: 'cinematic', label: 'Cinematic', description: 'Balanced banner glow', imageClass: 'opacity-40' },
  { id: 'glass', label: 'Glass', description: 'No blur, lighter panels', imageClass: 'opacity-65' },
  { id: 'clear', label: 'Clear', description: 'Sharper banner focus', imageClass: 'opacity-55' },
  { id: 'moody', label: 'Moody', description: 'Darker readable frame', imageClass: 'opacity-28' },
];

const SOCIAL_EFFECT_OPTIONS: Array<{ id: SocialEffectId; label: string; description: string }> = [
  { id: 'none', label: 'None', description: 'No overlay effect' },
  { id: 'sparkle', label: 'Sparkle', description: 'Visible star glints' },
  { id: 'scanline', label: 'Scanline', description: 'Tech texture overlay' },
  { id: 'halo', label: 'Halo', description: 'Strong profile glow' },
];

function getStreakVisual(days: number) {
  const normalizedDays = Math.max(0, Math.floor(days));
  return [...STREAK_VISUALS].reverse().find((visual) => normalizedDays >= visual.minDays) ?? STREAK_VISUALS[0];
}

declare global {
  interface Window {
    catrealmvisualdebug?: {
      profile: boolean;
      profileStreakDays: number;
      setProfile: (value: boolean) => void;
      setProfileStreakDays: (value: number) => void;
    };
  }
}

function readDisplayName(data: { displayName?: string | null; display_name?: string | null }) {
  return data.displayName ?? data.display_name ?? null;
}

function normalizeSocialProfileConfig(value: unknown): SocialProfileConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const favoriteData = data.favoriteRealm && typeof data.favoriteRealm === 'object' && !Array.isArray(data.favoriteRealm)
    ? data.favoriteRealm as Record<string, unknown>
    : null;
  const favoriteRealm = favoriteData && typeof favoriteData.name === 'string' && favoriteData.name.trim()
    ? {
      name: favoriteData.name.trim(),
      url: typeof favoriteData.url === 'string' ? favoriteData.url : null,
      icon: typeof favoriteData.icon === 'string' ? favoriteData.icon : null,
      banner: typeof favoriteData.banner === 'string' ? favoriteData.banner : null,
    }
    : null;
  const links = Array.isArray(data.links)
    ? data.links
      .map((link): SocialProfileLink | null => {
        if (!link || typeof link !== 'object') return null;
        const row = link as Record<string, unknown>;
        if (row.type !== 'youtube' && row.type !== 'twitch') return null;
        if (typeof row.url !== 'string' || !row.url.trim()) return null;
        return {
          type: row.type,
          url: row.url.trim(),
          label: typeof row.label === 'string' ? row.label.trim() || null : null,
          image: typeof row.image === 'string' ? row.image.trim() || null : null,
          banner: typeof row.banner === 'string' ? row.banner.trim() || null : null,
          verified: row.verified === true,
        };
      })
      .filter(Boolean) as SocialProfileLink[]
    : [];

  return favoriteRealm || links.length > 0 ? { favoriteRealm, links } : null;
}

// Central is the sole authority for the social profile. This only clears any
// stale config left in localStorage by the pre-Central (legacy) editor so it
// can never resurface and override Central.
function clearLegacySocialProfileConfig(userId: string | null | undefined) {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${SOCIAL_PROFILE_LOCAL_CONFIG_PREFIX}${userId}`);
  } catch {
    // Best-effort cleanup.
  }
}

function normalizeProfile(data: Partial<Profile> & {
  display_name?: string | null;
  social_profile_enabled?: boolean | number | null;
  socialProfileConfig?: unknown;
  social_profile_config?: unknown;
}): Profile {
  return {
    id: data.id || '',
    centralId: data.centralId ?? null,
    username: data.username || '',
    role: data.role || 'member',
    avatar: data.avatar ?? null,
    banner: data.banner ?? null,
    bio: data.bio ?? null,
    pronouns: data.pronouns ?? null,
    isOwner: data.isOwner ?? false,
    accountType: data.accountType ?? 'central',
    status: data.status ?? 'online',
    displayName: readDisplayName(data),
    customStatusText: data.customStatusText ?? null,
    socialProfileEnabled: data.socialProfileEnabled
      ?? (data.social_profile_enabled === true || data.social_profile_enabled === 1),
    socialProfileConfig: normalizeSocialProfileConfig(data.socialProfileConfig ?? data.social_profile_config),
    activityType: data.activityType ?? null,
    activityText: data.activityText ?? null,
    activityStartedAt: data.activityStartedAt ?? null,
    verified: data.verified ?? false,
    centralJoinDate: data.centralJoinDate,
    serverJoinDate: data.serverJoinDate,
    streakDays: data.streakDays ?? 0,
    clients: data.clients,
    badges: data.badges,
  };
}

function yearsSince(timestampSeconds: number | undefined) {
  if (!timestampSeconds) return 0;
  const elapsedMs = Date.now() - timestampSeconds * 1000;
  return Math.max(0, Math.floor(elapsedMs / (365.2425 * 24 * 60 * 60 * 1000)));
}

function resolveSocialAssetUrl(asset: string | null | undefined, baseUrl: string | null | undefined) {
  if (!asset) return null;
  if (/^https?:\/\//i.test(asset)) return asset;
  if (!baseUrl || !asset.startsWith('/')) return null;
  return `${baseUrl.replace(/\/+$/, '')}${asset}`;
}

function normalizeHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

function compareRealmUrl(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

function parseYouTubeChannelUrl(value: string) {
  const normalizedUrl = normalizeHttpUrl(value);
  if (!normalizedUrl) return null;
  try {
    const url = new URL(normalizedUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    if (host !== 'youtube.com') return null;
    const path = url.pathname.split('/').filter(Boolean);
    if (path.length === 0) return null;
    const [kind, rawValue] = path;
    if (kind.startsWith('@')) {
      return { label: kind, canonicalUrl: `https://www.youtube.com/${kind}` };
    }
    if ((kind === 'c' || kind === 'user') && rawValue) {
      return { label: rawValue, canonicalUrl: `https://www.youtube.com/${kind}/${rawValue}` };
    }
    if (kind === 'channel' && rawValue) {
      return { label: null, canonicalUrl: `https://www.youtube.com/channel/${rawValue}` };
    }
    return null;
  } catch {
    return null;
  }
}

function getSocialLinkWidget(link: SocialProfileLink) {
  let channelName = link.label || (link.type === 'youtube' ? 'YouTube Channel' : 'Twitch Channel');
  try {
    const url = new URL(link.url);
    const path = url.pathname.split('/').filter(Boolean);
    const candidate = path.find((part) => part !== 'c' && part !== 'channel' && part !== 'user') ?? path[0];
    if (!link.label && candidate) channelName = candidate.replace(/^@/, '@');
  } catch {
    channelName = link.type === 'youtube' ? 'YouTube Channel' : 'Twitch Channel';
  }

  return link.type === 'youtube'
    ? {
      title: 'YouTube',
      channelName,
      action: 'Open channel',
      shellClass: 'border-red-300/25 bg-[radial-gradient(circle_at_12%_15%,rgba(239,68,68,0.38),transparent_34%),linear-gradient(135deg,rgba(127,29,29,0.78),rgba(24,10,16,0.92))]',
      logoClass: 'bg-red-500 text-white',
      logo: 'YT',
      image: link.image ?? null,
      banner: link.banner ?? null,
      verified: link.verified === true,
    }
    : {
      title: 'Twitch',
      channelName,
      action: 'Open stream',
      shellClass: 'border-purple-300/25 bg-[radial-gradient(circle_at_12%_15%,rgba(168,85,247,0.42),transparent_34%),linear-gradient(135deg,rgba(88,28,135,0.76),rgba(20,10,31,0.92))]',
      logoClass: 'bg-purple-500 text-white',
      logo: 'T',
      image: link.image ?? null,
      banner: link.banner ?? null,
      verified: link.verified === true,
    };
}

type ProfileApiClient = {
  get: (url: string, config?: { params?: Record<string, string> }) => Promise<{ data: unknown }>;
  post: (url: string, body?: unknown) => Promise<{ data: unknown }>;
};

async function fetchYouTubeMetadata(
  apiClient: ProfileApiClient,
  channelUrl: string,
): Promise<Pick<SocialProfileLink, 'label' | 'image' | 'banner'> | null> {
  const normalizedUrl = normalizeHttpUrl(channelUrl);
  if (!normalizedUrl) return null;
  const res = await apiClient.get('/api/profile/social-metadata/youtube', { params: { url: normalizedUrl } });
  if (!res.data || typeof res.data !== 'object') return null;
  const data = res.data as Record<string, unknown>;
  if (data.found !== true) return null;
  const label = typeof data.label === 'string' ? data.label : null;
  const image = typeof data.image === 'string' ? data.image : null;
  const banner = typeof data.banner === 'string' ? data.banner : null;
  return label || image || banner ? { label, image, banner } : null;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function StreakBadge({ days, compact = false }: { days: number; compact?: boolean }) {
  const visual = getStreakVisual(days);
  const sizeClass = compact ? 'h-11 w-11 text-sm' : 'h-16 w-16 text-lg';
  const hasRim = visual.tier === 'enhanced' || visual.tier === 'elemental' || visual.tier === 'prestige';
  const hasFlames = visual.tier === 'elemental' || visual.tier === 'prestige';
  const hasParticles = visual.tier === 'prestige';
  const hasEars = visual.motif === 'head' || visual.motif === 'cosmic' || visual.motif === 'element';
  const hasWhiskers = visual.motif === 'head' || visual.motif === 'cosmic' || visual.tier === 'prestige';
  const hasPawPads = visual.motif === 'paw' || visual.motif === 'crystal' || visual.motif === 'cosmic' || visual.motif === 'element';
  const hasClaws = visual.motif === 'claw';
  const hasTail = visual.motif === 'tail';
  const hasBreathingEars = visual.label === 'Moon Kit' || visual.label === 'Winged Neko';

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-visible ${sizeClass}`}
      title={`${visual.label} - ${days} day${days === 1 ? '' : 's'}`}
    >
      {hasRim && (
        <span className={`absolute inset-[-3px] rounded-full bg-gradient-to-r ${visual.accent} opacity-70 blur-[1px] ${visual.tier === 'enhanced' ? 'animate-spin' : 'animate-pulse'}`} />
      )}
      {hasFlames && (
        <>
          <span className={`absolute -top-1 left-2 h-3 w-2 rounded-full bg-gradient-to-t ${visual.accent} opacity-80 blur-[1px] animate-pulse`} />
          <span className={`absolute -right-1 top-2 h-4 w-2 rounded-full bg-gradient-to-t ${visual.accent} opacity-70 blur-[1px] animate-pulse`} />
        </>
      )}
      {hasEars && (
        <>
          <span
            className={`absolute -top-1 left-[17%] h-[34%] w-[28%] -rotate-[18deg] border border-white/25 bg-gradient-to-br ${visual.accent} shadow-md shadow-black/30 ${hasBreathingEars ? 'animate-pulse' : ''}`}
            style={{ clipPath: 'polygon(50% 0, 0 100%, 100% 100%)' }}
          />
          <span
            className={`absolute -top-1 right-[17%] h-[34%] w-[28%] rotate-[18deg] border border-white/25 bg-gradient-to-br ${visual.accent} shadow-md shadow-black/30 ${hasBreathingEars ? 'animate-pulse' : ''}`}
            style={{ clipPath: 'polygon(50% 0, 0 100%, 100% 100%)' }}
          />
        </>
      )}
      {hasTail && (
        <span className={`absolute -right-2 bottom-1 h-[58%] w-[42%] rounded-full border-r-4 border-t-4 border-white/35 ${visual.tier === 'subtle' ? 'animate-pulse' : ''}`} />
      )}
      {hasParticles && (
        <>
          <span className={`absolute -left-1 top-1 h-1.5 w-1.5 rounded-full bg-white/80 shadow-[0_0_8px_currentColor] animate-pulse`} />
          <span className={`absolute bottom-0 right-0 h-1 w-1 rounded-full bg-cyan-200 shadow-[0_0_8px_currentColor] animate-pulse`} />
          <span className={`absolute -bottom-1 left-1/2 h-1 w-1 rounded-full bg-fuchsia-200 shadow-[0_0_8px_currentColor] animate-pulse`} />
        </>
      )}
      <span
        className={`relative flex h-full w-full items-center justify-center border-2 border-white/35 bg-gradient-to-br ${visual.accent} font-semibold text-white shadow-lg shadow-black/40 ${visual.tier === 'subtle' ? 'animate-pulse' : ''}`}
        style={{
          clipPath: visual.clipPath,
          borderRadius: visual.radius,
        }}
      >
        {hasWhiskers && (
          <>
            <span className="absolute left-0 top-[40%] h-px w-[28%] -rotate-12 bg-white/45" />
            <span className="absolute left-0 top-[55%] h-px w-[26%] rotate-6 bg-white/35" />
            <span className="absolute right-0 top-[40%] h-px w-[28%] rotate-12 bg-white/45" />
            <span className="absolute right-0 top-[55%] h-px w-[26%] -rotate-6 bg-white/35" />
          </>
        )}
        {hasPawPads && (
          <>
            <span className="absolute left-[30%] top-[20%] h-[13%] w-[13%] rounded-full bg-white/35" />
            <span className="absolute left-[45%] top-[16%] h-[13%] w-[13%] rounded-full bg-white/35" />
            <span className="absolute right-[30%] top-[20%] h-[13%] w-[13%] rounded-full bg-white/35" />
            <span className="absolute bottom-[15%] left-1/2 h-[22%] w-[30%] -translate-x-1/2 rounded-full bg-white/25" />
          </>
        )}
        {hasClaws && (
          <>
            <span className="absolute left-[30%] top-[15%] h-[70%] w-px rotate-[18deg] bg-white/45" />
            <span className="absolute left-1/2 top-[12%] h-[76%] w-px rotate-[18deg] bg-white/45" />
            <span className="absolute right-[30%] top-[15%] h-[70%] w-px rotate-[18deg] bg-white/45" />
          </>
        )}
        <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">{days}</span>
      </span>
    </span>
  );
}

export function SocialProfileEditorView({ onBack }: SocialProfileEditorViewProps) {
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const updateUser = useAuthStore((s) => s.updateUser);
  const updateOnlineUser = usePresenceStore((s) => s.updateOnlineUser);
  const servers = useServerStore((s) => s.servers);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [bioDraft, setBioDraft] = useState('');
  const [favoriteRealmUrlDraft, setFavoriteRealmUrlDraft] = useState('');
  const [youtubeUrlDraft, setYoutubeUrlDraft] = useState('');
  const [youtubeLabelDraft, setYoutubeLabelDraft] = useState('');
  const [youtubeImageDraft, setYoutubeImageDraft] = useState('');
  const [youtubeBannerDraft, setYoutubeBannerDraft] = useState('');
  const [youtubeVerifiedDraft, setYoutubeVerifiedDraft] = useState(false);
  const [twitchUrlDraft, setTwitchUrlDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingYouTubeMeta, setFetchingYouTubeMeta] = useState(false);
  const [verifyingYouTubeLink, setVerifyingYouTubeLink] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showcasePickerOpen, setShowcasePickerOpen] = useState(false);
  const [favoriteRealmEditorOpen, setFavoriteRealmEditorOpen] = useState(false);
  const [socialLinksEditorOpen, setSocialLinksEditorOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [streakLabelIndex, setStreakLabelIndex] = useState(0);
  const [debugProfileVisuals, setDebugProfileVisuals] = useState(false);
  const [debugStreakDays, setDebugStreakDays] = useState(365);
  const [selectedBadgeShowcase, setSelectedBadgeShowcase] = useState<ProfileBadgeShowcase | null>(null);
  const [badgeShowcaseClosing, setBadgeShowcaseClosing] = useState(false);
  const [socialThemeId, setSocialThemeId] = useState<SocialThemeId>('amethyst');
  const [socialBackgroundId, setSocialBackgroundId] = useState<SocialBackgroundId>('cinematic');
  const [socialEffectId, setSocialEffectId] = useState<SocialEffectId>('none');
  const [profileCompositorMode, setProfileCompositorMode] = useState<ProfileCompositorMode>('detecting');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const isCentral = user?.accountType === 'central';
  const assetBase = isCentral ? AUTH_BASE : serverUrl;
  const api = useMemo(() => (isCentral ? createAuthenticatedApi() : createApi()), [isCentral]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get('/api/profile/me')
      .then((res) => {
        if (cancelled) return;
        const nextProfile = normalizeProfile(res.data);
        clearLegacySocialProfileConfig(nextProfile.id || user.id);
        setProfile(nextProfile);
        setDisplayNameDraft(nextProfile.displayName ?? '');
        setBioDraft(nextProfile.bio ?? '');
        setFavoriteRealmUrlDraft(nextProfile.socialProfileConfig?.favoriteRealm?.url ?? '');
        const youtubeLink = nextProfile.socialProfileConfig?.links?.find((link) => link.type === 'youtube');
        setYoutubeUrlDraft(youtubeLink?.url ?? '');
        setYoutubeLabelDraft(youtubeLink?.label ?? '');
        setYoutubeImageDraft(youtubeLink?.image ?? '');
        setYoutubeBannerDraft(youtubeLink?.banner ?? '');
        setYoutubeVerifiedDraft(youtubeLink?.verified === true);
        setTwitchUrlDraft(nextProfile.socialProfileConfig?.links?.find((link) => link.type === 'twitch')?.url ?? '');
        setShowcasePickerOpen(false);
        setFavoriteRealmEditorOpen(false);
        setSocialLinksEditorOpen(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
        setError(message || 'Failed to load your main social profile.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, user]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStreakLabelIndex((index) => (index + 1) % STREAK_LABELS.length);
    }, 3200);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!selectedBadgeShowcase) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeBadgeShowcase();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedBadgeShowcase]);

  useEffect(() => {
    let cancelled = false;

    const detectCompositor = async () => {
      if (typeof window === 'undefined' || !window.electron?.getScreenShareVideoEncoding) {
        if (!cancelled) setProfileCompositorMode('browser');
        return;
      }

      const config = await window.electron.getScreenShareVideoEncoding().catch(() => null);
      if (cancelled) return;

      const backend = config?.applied?.encoderBackend ?? config?.encoderBackend;
      const gpuCompositing = config?.diagnostics?.chromiumGpuCompositing;

      if (gpuCompositing !== 'enabled') {
        setProfileCompositorMode('software');
      } else if (backend === 'd3d11') {
        setProfileCompositorMode('d3d11');
      } else if (backend === 'vulkan') {
        setProfileCompositorMode('vulkan');
      } else {
        setProfileCompositorMode('software');
      }
    };

    void detectCompositor();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const clampDebugDays = (value: number) => Math.max(0, Math.min(999, Math.floor(value)));
    let profileValue = Boolean(window.catrealmvisualdebug?.profile);
    let daysValue = clampDebugDays(Number(window.catrealmvisualdebug?.profileStreakDays) || 365);

    const debugState = window.catrealmvisualdebug ?? {
      profile: profileValue,
      profileStreakDays: daysValue,
      setProfile: (value: boolean) => {
        profileValue = Boolean(value);
      },
      setProfileStreakDays: (value: number) => {
        daysValue = clampDebugDays(Number(value) || 0);
      },
    };

    const notify = () => {
      window.dispatchEvent(new CustomEvent('catrealmvisualdebug:profile', {
        detail: {
          profile: profileValue,
          profileStreakDays: daysValue,
        },
      }));
    };

    Object.defineProperty(debugState, 'profile', {
      configurable: true,
      get: () => profileValue,
      set: (value) => {
        profileValue = Boolean(value);
        notify();
      },
    });

    Object.defineProperty(debugState, 'profileStreakDays', {
      configurable: true,
      get: () => daysValue,
      set: (value) => {
        daysValue = clampDebugDays(Number(value) || 0);
        notify();
      },
    });

    debugState.setProfile = (value: boolean) => {
      debugState.profile = value;
    };
    debugState.setProfileStreakDays = (value: number) => {
      debugState.profileStreakDays = value;
    };
    window.catrealmvisualdebug = debugState;

    const handleDebugChange = (event: Event) => {
      const detail = (event as CustomEvent<{ profile: boolean; profileStreakDays: number }>).detail;
      setDebugProfileVisuals(Boolean(detail?.profile));
      setDebugStreakDays(clampDebugDays(Number(detail?.profileStreakDays) || 0));
    };

    window.addEventListener('catrealmvisualdebug:profile', handleDebugChange);
    notify();

    return () => {
      window.removeEventListener('catrealmvisualdebug:profile', handleDebugChange);
    };
  }, []);

  const updateLocalProfile = (nextProfile: Profile) => {
    setProfile(nextProfile);
    updateUser({
      avatar: nextProfile.avatar ?? null,
      banner: nextProfile.banner ?? null,
      bio: nextProfile.bio ?? null,
      displayName: nextProfile.displayName ?? null,
      socialProfileEnabled: nextProfile.socialProfileEnabled,
      socialProfileConfig: nextProfile.socialProfileConfig ?? null,
    });
    updateOnlineUser(nextProfile.id, {
      avatar: nextProfile.avatar ?? null,
      displayName: nextProfile.displayName ?? null,
    });
  };

  const buildSocialProfileConfig = (): SocialProfileConfig | null => {
    const favoriteRealmKey = compareRealmUrl(favoriteRealmUrlDraft);
    const favoriteServer = servers.find((server) => compareRealmUrl(server.url) === favoriteRealmKey);
    const existingFavoriteRealm = profile?.socialProfileConfig?.favoriteRealm ?? null;
    const favoriteRealm = favoriteServer
      ? {
        name: favoriteServer.name || favoriteServer.info?.name || new URL(favoriteServer.url).hostname,
        url: favoriteServer.url,
        icon: favoriteServer.info?.serverIcon ?? favoriteServer.icon ?? null,
        banner: favoriteServer.info?.serverBanner ?? null,
      }
      : existingFavoriteRealm && compareRealmUrl(existingFavoriteRealm.url) === favoriteRealmKey
        ? existingFavoriteRealm
        : null;
    const links: NonNullable<SocialProfileConfig['links']> = [];
    const youtubeUrl = normalizeHttpUrl(youtubeUrlDraft);
    const twitchUrl = normalizeHttpUrl(twitchUrlDraft);
    if (youtubeUrl) {
      links.push({
        type: 'youtube',
        url: youtubeUrl,
        label: youtubeLabelDraft.trim() || null,
        image: normalizeHttpUrl(youtubeImageDraft) || null,
        banner: normalizeHttpUrl(youtubeBannerDraft) || null,
        verified: youtubeVerifiedDraft || null,
      });
    }
    if (twitchUrl) links.push({ type: 'twitch', url: twitchUrl });

    return favoriteRealm || links.length > 0
      ? { favoriteRealm, links }
      : null;
  };

  const saveIdentity = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const trimmedName = displayNameDraft.trim();
      const socialProfileConfig = buildSocialProfileConfig();
      let nextProfile = profile;

      if (trimmedName) {
        const res = await api.put('/api/profile/me/display-name', { displayName: trimmedName });
        nextProfile = normalizeProfile(res.data);
      } else {
        const res = await api.delete('/api/profile/me/display-name');
        nextProfile = normalizeProfile(res.data);
      }

      const bioRes = await api.put('/api/profile/me', {
        bio: bioDraft,
        socialProfileEnabled: true,
        socialProfileConfig,
      });
      nextProfile = normalizeProfile({ ...nextProfile, ...bioRes.data });
      clearLegacySocialProfileConfig(nextProfile.id || user?.id);
      updateLocalProfile(nextProfile);
      setDisplayNameDraft(nextProfile.displayName ?? '');
      setBioDraft(nextProfile.bio ?? '');
      setFavoriteRealmUrlDraft(nextProfile.socialProfileConfig?.favoriteRealm?.url ?? '');
      const youtubeLink = nextProfile.socialProfileConfig?.links?.find((link) => link.type === 'youtube');
      setYoutubeUrlDraft(youtubeLink?.url ?? '');
      setYoutubeLabelDraft(youtubeLink?.label ?? '');
      setYoutubeImageDraft(youtubeLink?.image ?? '');
      setYoutubeBannerDraft(youtubeLink?.banner ?? '');
      setYoutubeVerifiedDraft(youtubeLink?.verified === true);
      setTwitchUrlDraft(nextProfile.socialProfileConfig?.links?.find((link) => link.type === 'twitch')?.url ?? '');
      setShowcasePickerOpen(false);
      setFavoriteRealmEditorOpen(false);
      setSocialLinksEditorOpen(false);
      setEditing(false);
      setSavedNotice('Main social profile saved.');
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setError(message || 'Failed to save your main social profile.');
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (kind: 'avatar' | 'banner', file: File) => {
    const setBusy = kind === 'avatar' ? setUploadingAvatar : setUploadingBanner;
    setBusy(true);
    setError(null);
    setSavedNotice(null);
    try {
      const form = new FormData();
      form.append(kind, file);
      const res = await api.post(`/api/profile/me/${kind}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const nextProfile = normalizeProfile(res.data);
      updateLocalProfile(nextProfile);
      setSavedNotice(`${kind === 'avatar' ? 'Avatar' : 'Banner'} updated.`);
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setError(message || `Failed to upload ${kind}.`);
    } finally {
      setBusy(false);
    }
  };

  const handleFetchYouTubeMetadata = async () => {
    const youtubeUrl = normalizeHttpUrl(youtubeUrlDraft);
    const channelInfo = youtubeUrl ? parseYouTubeChannelUrl(youtubeUrl) : null;
    if (!youtubeUrl || !channelInfo) {
      setSavedNotice(null);
      setError('Enter a valid YouTube channel URL, like https://youtube.com/@catrealm or https://youtube.com/c/CatRealm.');
      return;
    }

    setFetchingYouTubeMeta(true);
    setError(null);
    setSavedNotice(null);
    try {
      if (channelInfo.canonicalUrl !== youtubeUrl) setYoutubeUrlDraft(channelInfo.canonicalUrl);
      if (channelInfo.label && !youtubeLabelDraft.trim()) setYoutubeLabelDraft(channelInfo.label);
      const meta = await fetchYouTubeMetadata(api, youtubeUrl);
      if (!meta) {
        setSavedNotice(channelInfo.label
          ? 'Channel name filled from URL. YouTube did not expose image/banner metadata.'
          : 'Valid channel URL, but YouTube did not expose image/banner metadata.');
        return;
      }
      if (meta.label) setYoutubeLabelDraft(meta.label);
      if (meta.image) setYoutubeImageDraft(meta.image);
      if (meta.banner) setYoutubeBannerDraft(meta.banner);
      setSavedNotice(meta.banner ? 'YouTube channel image and banner loaded.' : 'YouTube channel image loaded. Banner was not exposed.');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setSavedNotice('Channel name filled from URL. This server does not support YouTube metadata fetch yet.');
      } else {
        setSavedNotice('Could not fetch YouTube channel metadata. You can still save the channel URL.');
      }
    } finally {
      setFetchingYouTubeMeta(false);
    }
  };

  const handleVerifyYouTubeLink = async () => {
    const youtubeUrl = normalizeHttpUrl(youtubeUrlDraft);
    const channelInfo = youtubeUrl ? parseYouTubeChannelUrl(youtubeUrl) : null;
    if (!youtubeUrl || !channelInfo) {
      setSavedNotice(null);
      setError('Enter a valid YouTube channel URL before verifying.');
      return;
    }
    setVerifyingYouTubeLink(true);
    setError(null);
    setSavedNotice(null);
    try {
      const startRes = await api.post('/api/profile/social-links/youtube/verify/start', { url: channelInfo.canonicalUrl });
      const startData = startRes.data as Record<string, unknown>;
      const authUrl = typeof startData.authUrl === 'string' ? startData.authUrl : null;
      const verificationId = typeof startData.verificationId === 'string' ? startData.verificationId : null;
      if (!authUrl || !verificationId) throw new Error('bad_verification_start');

      await openExternalUrl(authUrl);
      setSavedNotice('Finish YouTube sign-in in your browser to verify this link.');

      for (let attempt = 0; attempt < 90; attempt += 1) {
        await delay(2000);
        const statusRes = await api.get(`/api/profile/social-links/youtube/verify/${encodeURIComponent(verificationId)}/status`);
        const status = statusRes.data as Record<string, unknown>;
        if (status.status === 'verified') {
          if (typeof status.url === 'string') setYoutubeUrlDraft(status.url);
          if (typeof status.label === 'string') setYoutubeLabelDraft(status.label);
          if (typeof status.image === 'string') setYoutubeImageDraft(status.image);
          if (typeof status.banner === 'string') setYoutubeBannerDraft(status.banner);
          setYoutubeVerifiedDraft(true);
          setSavedNotice('YouTube link verified. Save profile to keep it in your showcase.');
          return;
        }
        if (status.status === 'failed' || status.expired === true) {
          const message = typeof status.error === 'string' ? status.error : 'YouTube link verification failed.';
          setError(message);
          return;
        }
      }
      setSavedNotice('Verification is still pending. Try again after finishing Google sign-in.');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setSavedNotice('YouTube verification is not available on this server yet.');
        setError(null);
      } else {
        const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
        setError(message || 'Could not start YouTube link verification.');
      }
    } finally {
      setVerifyingYouTubeLink(false);
    }
  };

  const removeImage = async (kind: 'avatar' | 'banner') => {
    const setBusy = kind === 'avatar' ? setUploadingAvatar : setUploadingBanner;
    setBusy(true);
    setError(null);
    setSavedNotice(null);
    try {
      const res = await api.delete(`/api/profile/me/${kind}`);
      const nextProfile = normalizeProfile(res.data);
      updateLocalProfile(nextProfile);
      setSavedNotice(`${kind === 'avatar' ? 'Avatar' : 'Banner'} removed.`);
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setError(message || `Failed to remove ${kind}.`);
    } finally {
      setBusy(false);
    }
  };

  const avatarUrl = profile ? resolveAvatarUrl(profile.avatar, assetBase, profile.accountType) : null;
  const bannerUrl = profile ? resolveAvatarUrl(profile.banner ?? null, assetBase, profile.accountType) : null;
  const previewSocialConfig = editing ? buildSocialProfileConfig() : profile?.socialProfileConfig ?? null;
  const favoriteRealm = previewSocialConfig?.favoriteRealm ?? null;
  const favoriteRealmIconUrl = favoriteRealm
    ? resolveSocialAssetUrl(favoriteRealm.icon, favoriteRealm.url)
    : null;
  const favoriteRealmBannerUrl = favoriteRealm
    ? resolveSocialAssetUrl(favoriteRealm.banner, favoriteRealm.url)
    : null;
  const socialLinks = previewSocialConfig?.links ?? [];
  const showFavoriteRealmSection = !!favoriteRealm || (editing && favoriteRealmEditorOpen);
  const showSocialLinksSection = socialLinks.length > 0 || (editing && socialLinksEditorOpen);
  const hasAvailableShowcaseSlot = !showFavoriteRealmSection || !showSocialLinksSection;
  const displayName = displayNameDraft.trim() || profile?.displayName || profile?.username || 'Your profile';
  const bioPreview = bioDraft.trim() || 'Add a bio to make your main social profile feel more personal.';
  const accountJoinDate = profile?.centralJoinDate ?? profile?.serverJoinDate;
  const accountYears = yearsSince(accountJoinDate);
  const accountYearBadgeTier = yearBadgeTier(accountJoinDate);
  const badgeCount = (profile?.badges?.length ?? 0) + (profile?.accountType === 'central' ? 1 : 0) + (accountYearBadgeTier > 0 ? 1 : 0);
  const showcaseCount = (favoriteRealm ? 1 : 0) + socialLinks.length;
  const savedFavoriteRealm = profile?.socialProfileConfig?.favoriteRealm ?? null;
  const favoriteRealmInServerList = servers.some((server) => compareRealmUrl(server.url) === compareRealmUrl(savedFavoriteRealm?.url));
  // Central is the sole source: it counts a day once the user accumulates an
  // hour of connected time, on Hawaii (UTC-10) day boundaries. Invisible users
  // still accrue — invisibility is a display choice, not absence — so the badge
  // must not be zeroed here or they would bank days they can never show.
  const onlineStreakDays = profile?.streakDays ?? 0;
  const activeStreakDays = debugProfileVisuals ? debugStreakDays : onlineStreakDays;
  const activeStreakVisual = getStreakVisual(activeStreakDays);
  const yearBadgeImage = imageForYearBadge(accountYearBadgeTier);
  const identityBadgeSlots = (profile?.accountType === 'central' ? 1 : 0) + (yearBadgeImage ? 1 : 0);
  const profileBadgePreviews = (profile?.badges ?? []).slice(0, Math.max(0, 6 - identityBadgeSlots));
  const profileBadgeTiles = profileBadgePreviews.map((badge) => ({
    badge,
    imageSrc: imageForProfileBadge(badge),
  }));
  const earnedStreakVisuals = STREAK_VISUALS.filter((visual) => activeStreakDays >= visual.minDays);
  const showcasedStreakVisuals = earnedStreakVisuals.slice(-Math.max(0, 6 - identityBadgeSlots - profileBadgePreviews.length));
  const collectorBadgeCount = badgeCount + earnedStreakVisuals.length;
  const socialTheme = SOCIAL_THEME_OPTIONS.find((theme) => theme.id === socialThemeId) ?? SOCIAL_THEME_OPTIONS[0];
  const socialBackground = SOCIAL_BACKGROUND_OPTIONS.find((background) => background.id === socialBackgroundId) ?? SOCIAL_BACKGROUND_OPTIONS[0];
  const socialEffect = SOCIAL_EFFECT_OPTIONS.find((effect) => effect.id === socialEffectId) ?? SOCIAL_EFFECT_OPTIONS[0];
  const isGlassBackground = socialBackgroundId === 'glass';
  const profilePanelClass = isGlassBackground
    ? 'border border-white/15 bg-white/10 shadow-lg shadow-black/25'
    : 'bg-black/35';
  const sidePanelClass = isGlassBackground
    ? 'border border-white/15 bg-white/10 shadow-lg shadow-black/25'
    : 'bg-black/40';
  const statPanelClass = isGlassBackground ? 'bg-white/10 border border-white/10' : 'bg-black/45';
  const pageOverlayClass = isGlassBackground
    ? 'bg-[linear-gradient(90deg,rgba(0,0,0,0.34),rgba(0,0,0,0.30))]'
    : socialTheme.pageOverlayClass;
  const heroGradient = isGlassBackground
    ? 'linear-gradient(135deg, rgba(0,0,0,0.28), rgba(0,0,0,0.18))'
    : socialTheme.heroGradient;
  const useRichProfileEffects = profileCompositorMode === 'd3d11' || profileCompositorMode === 'browser';
  const profileEffectModeLabel = useRichProfileEffects
    ? profileCompositorMode === 'browser' ? 'Browser rich' : 'D3D11 rich'
    : profileCompositorMode === 'vulkan' ? 'Vulkan safe' : profileCompositorMode === 'detecting' ? 'Detecting' : 'Software safe';
  const editorButtonClass = 'w-full justify-center bg-[#4b255c] hover:bg-[#5b2e70] text-text-primary border border-[#704080]/40';
  const removeButtonClass = 'text-[#d5bfdc] hover:bg-[#4b255c]/70 hover:text-text-primary';
  const primaryProfileActionLabel = editing
    ? saving ? 'Saving...' : 'Save Profile'
    : 'Edit Social Profile';

  const handlePrimaryProfileAction = () => {
    if (!editing) {
      setSavedNotice(null);
      setEditing(true);
      return;
    }

    void saveIdentity();
  };

  const openFavoriteRealmShowcaseEditor = () => {
    setFavoriteRealmEditorOpen(true);
    setShowcasePickerOpen(false);
  };

  const openSocialLinksShowcaseEditor = () => {
    setSocialLinksEditorOpen(true);
    setShowcasePickerOpen(false);
  };

  const showComingSoon = (label: string) => {
    setError(null);
    setSavedNotice(`${label} customization is not wired yet.`);
  };

  const openBadgeShowcase = (badge: ProfileBadgeShowcase) => {
    setBadgeShowcaseClosing(false);
    setSelectedBadgeShowcase(badge);
  };

  const closeBadgeShowcase = () => {
    if (!selectedBadgeShowcase || badgeShowcaseClosing) return;
    setBadgeShowcaseClosing(true);
    window.setTimeout(() => {
      setSelectedBadgeShowcase(null);
      setBadgeShowcaseClosing(false);
    }, 220);
  };

  return (
    <div className={`relative flex flex-1 min-h-0 flex-col overflow-hidden ${socialTheme.rootClass}`}>
      <div
        className={`pointer-events-none absolute inset-0 bg-cover bg-center ${socialBackground.imageClass}`}
        style={bannerUrl ? { backgroundImage: `url("${bannerUrl}")` } : undefined}
      />
      <div className={`pointer-events-none absolute inset-0 ${pageOverlayClass}`} />
      {useRichProfileEffects && !isGlassBackground && (
        <div className="social-profile-rich-drift pointer-events-none absolute inset-[-8%] z-[1] opacity-45 mix-blend-screen bg-[radial-gradient(circle_at_18%_22%,rgba(56,189,248,0.34),transparent_30%),radial-gradient(circle_at_82%_16%,rgba(244,114,182,0.34),transparent_32%),radial-gradient(circle_at_52%_84%,rgba(168,85,247,0.24),transparent_34%)]" />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
      {socialEffectId === 'sparkle' && useRichProfileEffects && (
        <div className="social-profile-rich-sparkle pointer-events-none absolute inset-x-0 inset-y-[-16px] z-[2] opacity-55 mix-blend-screen bg-[radial-gradient(circle_at_12%_18%,rgba(255,255,255,0.86)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_24%_62%,rgba(125,249,255,0.62)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_44%_30%,rgba(255,255,255,0.72)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_66%_78%,rgba(236,72,153,0.58)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_84%_22%,rgba(255,255,255,0.70)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_94%_58%,rgba(167,139,250,0.58)_0_1.5px,transparent_2.5px)]" />
      )}
      {socialEffectId === 'sparkle' && !useRichProfileEffects && (
        <div className="pointer-events-none absolute inset-0 z-[2] opacity-35 bg-[radial-gradient(circle_at_14%_18%,rgba(255,255,255,0.70)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_32%_76%,rgba(255,255,255,0.46)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_58%_24%,rgba(255,255,255,0.58)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_80%_62%,rgba(255,255,255,0.52)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_92%_18%,rgba(255,255,255,0.44)_0_1.5px,transparent_2.5px)]" />
      )}
      {socialEffectId === 'scanline' && useRichProfileEffects && (
        <div className="social-profile-rich-scanline pointer-events-none absolute inset-x-0 inset-y-[-50%] z-[2] opacity-30 mix-blend-screen bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.22)_0_1px,transparent_1px_5px)]" />
      )}
      {socialEffectId === 'scanline' && !useRichProfileEffects && (
        <div className="pointer-events-none absolute inset-0 z-[2] opacity-25 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.16)_0_1px,transparent_1px_4px)]" />
      )}
      {socialEffectId === 'halo' && useRichProfileEffects && (
        <div className="social-profile-rich-halo pointer-events-none absolute inset-0 z-[2] opacity-55 mix-blend-screen bg-[radial-gradient(circle_at_18%_34%,rgba(56,189,248,0.30),transparent_28%),radial-gradient(circle_at_82%_20%,rgba(244,114,182,0.28),transparent_30%),radial-gradient(circle_at_50%_82%,rgba(168,85,247,0.26),transparent_32%)]" />
      )}
      {socialEffectId === 'halo' && !useRichProfileEffects && (
        <div className="pointer-events-none absolute inset-0 z-[2] opacity-40 bg-[radial-gradient(circle_at_18%_34%,rgba(255,255,255,0.24),transparent_24%),radial-gradient(circle_at_82%_20%,rgba(255,255,255,0.18),transparent_28%),radial-gradient(circle_at_50%_82%,rgba(255,255,255,0.16),transparent_30%)]" />
      )}

      <header className={`relative z-10 shrink-0 border-b border-white/10 px-4 py-3 ${isGlassBackground ? 'bg-black/20' : 'bg-black/35'}`}>
        <div className="mx-auto flex max-w-[1040px] items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md p-2 text-[#d8c9f4] transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-text-primary">Main Social Profile</h1>
            <p className="truncate text-xs text-[#a99abf]">CatRealm Social Profile - inspired by steam social profile system</p>
          </div>
          <Button onClick={handlePrimaryProfileAction} disabled={saving || loading} className="bg-[#7c3aed] hover:bg-[#8b5cf6]">
            <span className="inline-flex items-center gap-2">
              {editing ? <Save className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {primaryProfileActionLabel}
            </span>
          </Button>
        </div>
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1040px] px-4 py-6">
          <section
            className="relative overflow-hidden rounded-sm border border-white/10 bg-cover bg-center shadow-2xl shadow-black/45"
            style={bannerUrl
              ? {
                backgroundImage: `${heroGradient}, url("${bannerUrl}")`,
              }
              : {
                backgroundImage: heroGradient,
              }}
          >
            <div className="relative z-10 grid gap-5 p-5 lg:grid-cols-[180px_minmax(0,1fr)_310px]">
              <div className="relative h-[180px] w-[180px] overflow-hidden rounded-sm border border-pink-300/40 bg-black/40 shadow-lg shadow-black/45">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-pink-400/50 to-cyan-500/40 text-5xl font-semibold text-white">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 rounded-sm ring-1 ring-white/10" />
              </div>

              <div className="min-w-0">
                <h2 className="truncate text-3xl font-light text-white">{displayName}</h2>
                <p className="mt-1 text-sm text-[#d8d0df]">@{profile?.username ?? user?.username}</p>
                <div className="mt-3 text-sm leading-relaxed text-[#dfd5e5]">
                  <p className="whitespace-pre-wrap">{bioPreview}</p>
                </div>
                {profile && (
                  <div className="mt-4">
                    <ProfileBadges profile={profile} onBadgeImageClick={openBadgeShowcase} />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => showComingSoon('Expanded profile info')}
                  className="mt-4 text-sm font-semibold text-[#d8d0df] hover:text-white"
                >
                  View more info
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-3">
                  <div className="relative h-8 min-w-0 overflow-hidden">
                    {STREAK_LABELS.map((label, index) => (
                      <span
                        key={label}
                        className={`absolute inset-0 flex items-center whitespace-nowrap text-[clamp(1.15rem,1.8vw,1.5rem)] font-light text-white transition-all duration-500 ${
                          streakLabelIndex === index
                            ? 'translate-y-0 opacity-100'
                            : 'translate-y-1 opacity-0'
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <StreakBadge days={activeStreakDays} compact />
                </div>
                <div className={`rounded-sm p-3 ${profilePanelClass}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center">
                      <StreakBadge days={activeStreakDays} compact />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Current Streak</p>
                      <p className="text-xs text-[#c8bccf]">{activeStreakDays} day{activeStreakDays === 1 ? '' : 's'} online marker</p>
                    </div>
                  </div>
                </div>
                <Button onClick={handlePrimaryProfileAction} disabled={saving || loading} className={socialTheme.ctaClass}>
                  {primaryProfileActionLabel}
                </Button>
              </div>
            </div>
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
            <section className="space-y-4">
              <div className={`overflow-hidden rounded-sm ${profilePanelClass}`}>
                <div className={`${socialTheme.sectionHeaderClass} px-4 py-2 text-lg`}>
                  Badge Collector
                </div>
                <div className="p-4">
                  <div className="flex flex-wrap gap-4">
                    {profile?.accountType === 'central' && (
                      <div className="flex w-24 flex-col items-center gap-2 text-center" title="Uses CatRealm Central identity.">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-cyan-300/45 bg-cyan-400/15 text-cyan-100 shadow-lg shadow-black/30">
                          <ShieldCheck className="h-7 w-7" />
                        </div>
                        <span className="w-full text-center text-[11px] font-semibold leading-tight text-[#d8d0df]">
                          Central Account
                        </span>
                      </div>
                    )}
                    {yearBadgeImage && (
                      <button
                        type="button"
                        className="flex w-24 flex-col items-center gap-2 rounded-md text-center outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-cyan-300"
                        title={`Year ${accountYearBadgeTier} account age badge.`}
                        onClick={() => openBadgeShowcase({
                          label: `Year ${accountYearBadgeTier}`,
                          description: `Year ${accountYearBadgeTier} account age badge.`,
                          imageSrc: yearBadgeImage,
                          backgroundSrc: backgroundForBadgeImage(yearBadgeImage),
                        })}
                      >
                        <div className="flex h-16 w-16 items-center justify-center overflow-visible bg-transparent">
                          <img src={yearBadgeImage} alt="" className="h-full w-full object-contain drop-shadow-[0_8px_12px_rgba(0,0,0,0.45)]" />
                        </div>
                        <span className="w-full text-center text-[11px] font-semibold leading-tight text-[#d8d0df]">
                          Year {accountYearBadgeTier}
                        </span>
                      </button>
                    )}
                    {profileBadgeTiles.map(({ badge, imageSrc }) => (
                      <button
                        key={badge.id}
                        type="button"
                        disabled={!imageSrc}
                        className="flex w-24 flex-col items-center gap-2 rounded-md text-center outline-none transition-transform enabled:hover:scale-[1.04] enabled:focus-visible:ring-2 enabled:focus-visible:ring-cyan-300 disabled:cursor-default"
                        title={badge.description ?? badge.label}
                        onClick={() => {
                          if (!imageSrc) return;
                          openBadgeShowcase({
                            label: badge.label,
                            description: badge.description,
                            imageSrc,
                            backgroundSrc: backgroundForBadgeImage(imageSrc),
                          });
                        }}
                      >
                        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-gradient-to-br from-yellow-300/30 to-pink-500/30 text-center text-xs font-semibold text-white shadow-lg shadow-black/30">
                          {imageSrc ? (
                            <img src={imageSrc} alt="" className="h-full w-full object-cover" />
                          ) : (
                            badge.label.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <span className="w-full truncate text-center text-[11px] font-semibold leading-tight text-[#d8d0df]">
                          {badge.label}
                        </span>
                      </button>
                    ))}
                    {showcasedStreakVisuals.map((visual) => (
                      <div key={visual.label} className="flex w-24 flex-col items-center gap-2 text-center" title={`${visual.label} unlocks at ${visual.minDays} days`}>
                        <StreakBadge days={visual.minDays} />
                        <span className="w-full truncate text-center text-[11px] font-semibold leading-tight text-[#d8d0df]">
                          {visual.label}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className={`mt-4 grid grid-cols-2 rounded-sm p-3 ${statPanelClass}`}>
                    <div>
                      <p className="text-4xl font-light text-white">{collectorBadgeCount}</p>
                      <p className="text-sm text-[#aaa2ad]">Total Badges Earned</p>
                    </div>
                    <div>
                      <p className="text-4xl font-light text-white">{activeStreakDays}</p>
                      <p className="text-sm text-[#aaa2ad]">Online Streak</p>
                    </div>
                  </div>
                </div>
              </div>

              {editing && (
                <div className={`overflow-hidden rounded-sm ${profilePanelClass}`}>
                  <div className={`${socialTheme.sectionHeaderClass} px-4 py-2 text-lg`}>
                    Social Showcase
                  </div>
                  <div className="space-y-4 p-4">
                    <label className="block">
                      <span className="text-xs font-medium text-[#d8c9f4]">Display name</span>
                      <input
                        value={displayNameDraft}
                        maxLength={32}
                        onChange={(event) => setDisplayNameDraft(event.target.value)}
                        placeholder={profile?.username ?? 'Display name'}
                        className="mt-1 w-full rounded-sm border border-white/10 bg-black/55 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-[#8b5cf6]"
                      />
                      <span className="mt-1 block text-xs text-[#8f79b7]">{displayNameDraft.length}/32</span>
                    </label>

                    <label className="block">
                      <span className="text-xs font-medium text-[#d8c9f4]">Bio</span>
                      <textarea
                        value={bioDraft}
                        maxLength={500}
                        rows={7}
                        onChange={(event) => setBioDraft(event.target.value)}
                        placeholder="Tell people what you are about."
                        className="mt-1 w-full resize-none rounded-sm border border-white/10 bg-black/55 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-[#8b5cf6]"
                      />
                      <span className="mt-1 block text-xs text-[#8f79b7]">{bioDraft.length}/500</span>
                    </label>
                  </div>
                </div>
              )}

              {showFavoriteRealmSection && (
                <div className={`overflow-hidden rounded-sm ${profilePanelClass}`}>
                  <div className={`${socialTheme.sectionHeaderClass} px-4 py-2 text-lg`}>
                    Favorite Realm
                  </div>
                  <div className="space-y-4 p-4">
                    {favoriteRealm && (
                      <div
                        className={`relative flex min-h-28 items-center gap-4 overflow-hidden rounded-sm p-4 ${statPanelClass}`}
                        style={favoriteRealmBannerUrl ? { backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0.72), rgba(0,0,0,0.42)), url("${favoriteRealmBannerUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                      >
                        <div className="relative z-10 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-white/10 bg-black/45 text-[#aaa2ad]">
                          {favoriteRealmIconUrl ? (
                            <img src={favoriteRealmIconUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Gamepad2 className="h-7 w-7" />
                          )}
                        </div>
                        <div className="relative z-10 min-w-0">
                          <p className="truncate text-2xl font-light text-white">{favoriteRealm.name}</p>
                          <p className="truncate text-sm text-[#aaa2ad]">Featured social space</p>
                        </div>
                      </div>
                    )}
                    {editing && (
                      <label className="block">
                        <span className="text-xs font-medium text-[#d8c9f4]">Favorite Realm</span>
                        <select
                          value={favoriteRealmUrlDraft}
                          onChange={(event) => setFavoriteRealmUrlDraft(event.target.value)}
                          className="mt-1 w-full rounded-sm border border-white/10 bg-black/55 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-[#8b5cf6]"
                        >
                          <option value="">No favorite realm</option>
                          {savedFavoriteRealm && !favoriteRealmInServerList && savedFavoriteRealm.url && (
                            <option value={savedFavoriteRealm.url}>
                              {savedFavoriteRealm.name}
                            </option>
                          )}
                          {servers.map((server) => (
                            <option key={server.url} value={server.url}>
                              {server.name || server.info?.name || server.url}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </div>
              )}

              {showSocialLinksSection && (
                <div className={`overflow-hidden rounded-sm ${profilePanelClass}`}>
                  <div className={`${socialTheme.sectionHeaderClass} px-4 py-2 text-lg`}>
                    Social Links
                  </div>
                  <div className="space-y-3 p-4">
                    {socialLinks.length > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {socialLinks.map((link) => {
                          const widget = getSocialLinkWidget(link);
                          return (
                            <a
                              key={`${link.type}-${link.url}`}
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              className={`group relative min-h-32 overflow-hidden rounded-sm border p-4 text-white shadow-lg shadow-black/25 transition-transform hover:-translate-y-0.5 ${widget.shellClass}`}
                            >
                              {widget.banner && (
                                <div
                                  className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-35"
                                  style={{ backgroundImage: `url("${widget.banner}")` }}
                                />
                              )}
                              <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-white/10 to-transparent" />
                              <div className="relative z-10 flex items-start gap-3">
                                <div className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm text-xl font-bold shadow-lg shadow-black/35 ${widget.logoClass}`}>
                                  {widget.image ? (
                                    <img src={widget.image} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    widget.logo
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="truncate text-lg font-semibold">{widget.title}</p>
                                    <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/80">
                                      {widget.verified ? 'Verified' : 'Channel'}
                                    </span>
                                  </div>
                                  <p className="mt-1 truncate text-sm text-white/82">{widget.channelName}</p>
                                  <p className="mt-3 truncate text-xs text-white/55">{link.url}</p>
                                </div>
                              </div>
                              <div className="relative z-10 mt-4 inline-flex items-center rounded-sm border border-white/15 bg-black/20 px-3 py-1 text-xs font-semibold text-white/90 transition-colors group-hover:bg-white/10">
                                {widget.action}
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    )}
                    {editing && (
                      <div className="grid gap-3 pt-2">
                        <label className="block">
                          <span className="text-xs font-medium text-[#d8c9f4]">YouTube Channel</span>
                          <input
                            value={youtubeUrlDraft}
                            onChange={(event) => {
                              setYoutubeUrlDraft(event.target.value);
                              setYoutubeVerifiedDraft(false);
                            }}
                            placeholder="https://youtube.com/@catrealm"
                            className="mt-1 w-full rounded-sm border border-white/10 bg-black/55 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-[#8b5cf6]"
                          />
                        </label>
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                          <input
                            value={youtubeLabelDraft}
                            onChange={(event) => setYoutubeLabelDraft(event.target.value)}
                            placeholder="YouTube channel name"
                            className="w-full rounded-sm border border-white/10 bg-black/55 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-[#8b5cf6]"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void handleFetchYouTubeMetadata()}
                            disabled={fetchingYouTubeMeta || !youtubeUrlDraft.trim()}
                            className="justify-center"
                          >
                            {fetchingYouTubeMeta ? 'Fetching...' : 'Fetch YouTube'}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void handleVerifyYouTubeLink()}
                            disabled={verifyingYouTubeLink || !youtubeUrlDraft.trim()}
                            className="justify-center"
                          >
                            {verifyingYouTubeLink ? 'Verifying...' : 'Verify Link'}
                          </Button>
                        </div>
                        <input
                          value={youtubeImageDraft}
                          onChange={(event) => setYoutubeImageDraft(event.target.value)}
                          placeholder="Channel image URL"
                          className="w-full rounded-sm border border-white/10 bg-black/55 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-[#8b5cf6]"
                        />
                        <input
                          value={youtubeBannerDraft}
                          onChange={(event) => setYoutubeBannerDraft(event.target.value)}
                          placeholder="Channel banner URL (manual for now)"
                          className="w-full rounded-sm border border-white/10 bg-black/55 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-[#8b5cf6]"
                        />
                        <label className="block">
                          <span className="text-xs font-medium text-[#d8c9f4]">Twitch Channel</span>
                          <input
                            value={twitchUrlDraft}
                            onChange={(event) => setTwitchUrlDraft(event.target.value)}
                            placeholder="https://twitch.tv/catrealm"
                            className="mt-1 w-full rounded-sm border border-white/10 bg-black/55 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-[#8b5cf6]"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {editing && hasAvailableShowcaseSlot && (
                <div className={`overflow-hidden rounded-sm ${profilePanelClass}`}>
                  <button
                    type="button"
                    onClick={() => setShowcasePickerOpen((open) => !open)}
                    className="flex w-full items-center justify-center gap-2 px-4 py-4 text-sm font-semibold text-[#d8c9f4] transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <span className="text-lg leading-none">+</span>
                    Showcase
                  </button>
                  {showcasePickerOpen && (
                    <div className="grid gap-2 border-t border-white/10 p-4 sm:grid-cols-2">
                      {!showFavoriteRealmSection && (
                        <button
                          type="button"
                          onClick={openFavoriteRealmShowcaseEditor}
                          className="rounded-sm border border-white/10 bg-white/5 px-3 py-3 text-left transition-colors hover:border-cyan-300/45 hover:bg-cyan-300/10"
                        >
                          <span className="block text-sm font-semibold text-white">Favorite Realm</span>
                          <span className="mt-1 block text-xs text-[#a99abf]">Feature one saved realm with icon and banner.</span>
                        </button>
                      )}
                      {!showSocialLinksSection && (
                        <button
                          type="button"
                          onClick={openSocialLinksShowcaseEditor}
                          className="rounded-sm border border-white/10 bg-white/5 px-3 py-3 text-left transition-colors hover:border-fuchsia-300/45 hover:bg-fuchsia-300/10"
                        >
                          <span className="block text-sm font-semibold text-white">Channel Links</span>
                          <span className="mt-1 block text-xs text-[#a99abf]">Add YouTube or Twitch channel widgets.</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            <aside className="space-y-4">
              {debugProfileVisuals && (
                <div className="rounded-sm border border-cyan-300/30 bg-black/50 p-4 shadow-lg shadow-cyan-950/20">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-cyan-100">Profile Visual Debug</h3>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-[#b7aebc]">
                      {activeStreakVisual.label}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-4">
                    <StreakBadge days={activeStreakDays} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{activeStreakDays} day streak</p>
                      <p className="text-xs text-[#b7aebc]">{activeStreakVisual.shape} / {activeStreakVisual.tier}</p>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={900}
                    step={1}
                    value={debugStreakDays}
                    onChange={(event) => {
                      const nextDays = Number(event.target.value);
                      setDebugStreakDays(nextDays);
                      if (window.catrealmvisualdebug) {
                        window.catrealmvisualdebug.profileStreakDays = nextDays;
                      }
                    }}
                    className="mt-4 w-full accent-cyan-300"
                  />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {STREAK_VISUALS.map((visual) => (
                      <button
                        key={visual.label}
                        type="button"
                        onClick={() => {
                          setDebugStreakDays(visual.minDays);
                          if (window.catrealmvisualdebug) {
                            window.catrealmvisualdebug.profileStreakDays = visual.minDays;
                          }
                        }}
                        className={`rounded-sm border px-2 py-1 text-left text-[11px] transition-colors ${
                          activeStreakVisual.label === visual.label
                            ? 'border-cyan-300/70 bg-cyan-300/10 text-cyan-100'
                            : 'border-white/10 bg-white/5 text-[#b7aebc] hover:border-white/25 hover:text-white'
                        }`}
                      >
                        <span className="block truncate font-semibold">{visual.label}</span>
                        <span className="block">{visual.minDays}d</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-[#9585a5]">Console: catrealmvisualdebug.profile = false</p>
                </div>
              )}

              {debugProfileVisuals && (
                <div className="rounded-sm border border-fuchsia-300/25 bg-black/50 p-4 shadow-lg shadow-fuchsia-950/20">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-fuchsia-100">Badge Animation Debug</h3>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-[#b7aebc]">
                      {DEBUG_BADGE_SHOWCASES.length} badges
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {DEBUG_BADGE_SHOWCASES.map((badge) => (
                      <button
                        key={badge.label}
                        type="button"
                        onClick={() => openBadgeShowcase(badge)}
                        className="group flex min-w-0 flex-col items-center gap-2 rounded-md border border-white/10 bg-white/5 p-2 text-center transition-colors hover:border-fuchsia-200/60 hover:bg-fuchsia-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
                      >
                        <img
                          src={badge.imageSrc}
                          alt=""
                          className="h-14 w-14 object-contain drop-shadow-[0_5px_8px_rgba(0,0,0,0.45)] transition-transform group-hover:scale-105"
                        />
                        <span className="w-full truncate text-[11px] font-semibold text-[#d8d0df]">
                          {badge.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-[#9585a5]">Click any badge to replay its overlay animation.</p>
                </div>
              )}

              <div className={`rounded-sm p-4 ${sidePanelClass}`}>
                <h3 className={`text-2xl font-light ${socialTheme.accentTextClass}`}>Currently Online</h3>
                <p className="mt-6 text-sm text-[#b7aebc]">Profile Awards <span className="text-2xl text-[#b784c8]">{badgeCount}</span></p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Array.from({ length: Math.min(4, Math.max(1, badgeCount)) }).map((_, index) => (
                    <div key={index} className="flex h-10 w-10 items-center justify-center rounded-sm bg-gradient-to-br from-cyan-400/30 to-purple-500/40">
                      <Award className="h-5 w-5 text-white" />
                    </div>
                  ))}
                </div>
                <div className="mt-7 space-y-3 text-sm text-[#ddd5e2]">
                  <p>Badges <span className="ml-2 text-2xl text-[#b784c8]">{badgeCount}</span></p>
                  <p>Years <span className="ml-2 text-2xl text-[#b784c8]">{accountYears || 1}</span></p>
                  <p>Showcases <span className="ml-2 text-2xl text-[#b784c8]">{showcaseCount}</span></p>
                  <p>Visibility <span className="ml-2 text-[#b7aebc]">Public preview</span></p>
                </div>
              </div>

              {editing && (
                <>
                  <div className={`rounded-sm p-4 ${sidePanelClass}`}>
                    <h3 className="text-sm font-semibold text-white">Profile Editor</h3>
                    <div className="mt-4 space-y-3">
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) void uploadImage('avatar', file);
                        }}
                      />
                      <input
                        ref={bannerInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) void uploadImage('banner', file);
                        }}
                      />
                      <Button variant="secondary" className={editorButtonClass} onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar}>
                        <span className="inline-flex items-center gap-2">
                          <Camera className="h-4 w-4" />
                          {uploadingAvatar ? 'Uploading...' : 'Change avatar'}
                        </span>
                      </Button>
                      <Button variant="secondary" className={editorButtonClass} onClick={() => bannerInputRef.current?.click()} disabled={uploadingBanner}>
                        <span className="inline-flex items-center gap-2">
                          <Images className="h-4 w-4" />
                          {uploadingBanner ? 'Uploading...' : 'Change background'}
                        </span>
                      </Button>
                      <div className="grid grid-cols-2 gap-2 pt-2">
                        <Button variant="ghost" className={removeButtonClass} onClick={() => void removeImage('avatar')} disabled={!profile?.avatar || uploadingAvatar}>
                          <span className="inline-flex items-center gap-1.5">
                            <Trash2 className="h-3.5 w-3.5" />
                            Avatar
                          </span>
                        </Button>
                        <Button variant="ghost" className={removeButtonClass} onClick={() => void removeImage('banner')} disabled={!profile?.banner || uploadingBanner}>
                          <span className="inline-flex items-center gap-1.5">
                            <Trash2 className="h-3.5 w-3.5" />
                            Background
                          </span>
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-sm p-4 ${sidePanelClass}`}>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-white">Social Editor</h3>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-[#b7aebc]">
                        Preview only
                      </span>
                    </div>
                    <div className="mt-4 space-y-5">
                      <div>
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#d8c9f4]">
                          <Palette className="h-3.5 w-3.5" />
                          Color theme
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {SOCIAL_THEME_OPTIONS.map((theme) => (
                            <button
                              key={theme.id}
                              type="button"
                              onClick={() => {
                                setSocialThemeId(theme.id);
                                setSavedNotice(`${theme.label} social theme preview applied.`);
                              }}
                              className={`rounded-sm border p-2 text-left transition-colors ${
                                socialThemeId === theme.id
                                  ? 'border-cyan-300/70 bg-cyan-300/10 text-white'
                                  : 'border-white/10 bg-white/5 text-[#d8d0df] hover:border-white/25 hover:text-white'
                              }`}
                            >
                              <span className={`mb-1 block h-3 rounded-full bg-gradient-to-r ${theme.swatchClass}`} />
                              <span className="block truncate text-xs font-semibold">{theme.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#d8c9f4]">
                          <ImagePlus className="h-3.5 w-3.5" />
                          Background
                        </div>
                        <div className="space-y-2">
                          {SOCIAL_BACKGROUND_OPTIONS.map((background) => (
                            <button
                              key={background.id}
                              type="button"
                              onClick={() => {
                                setSocialBackgroundId(background.id);
                                setSavedNotice(`${background.label} background preview applied.`);
                              }}
                              className={`w-full rounded-sm border px-3 py-2 text-left transition-colors ${
                                socialBackgroundId === background.id
                                  ? 'border-cyan-300/70 bg-cyan-300/10 text-white'
                                  : 'border-white/10 bg-white/5 text-[#d8d0df] hover:border-white/25 hover:text-white'
                              }`}
                            >
                              <span className="block text-xs font-semibold">{background.label}</span>
                              <span className="block text-[11px] text-[#a99abf]">{background.description}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#d8c9f4]">
                            <Wand2 className="h-3.5 w-3.5" />
                            Effects
                          </span>
                          <span className="text-[11px] text-[#9585a5]">{socialEffect.label}</span>
                        </div>
                        <div className="mb-2 rounded-sm border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-[#a99abf]">
                          Render path: <span className="font-semibold text-[#d8c9f4]">{profileEffectModeLabel}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {SOCIAL_EFFECT_OPTIONS.map((effect) => (
                            <button
                              key={effect.id}
                              type="button"
                              onClick={() => {
                                setSocialEffectId(effect.id);
                                setSavedNotice(`${effect.label} effect preview applied.`);
                              }}
                              className={`rounded-sm border px-3 py-2 text-left transition-colors ${
                                socialEffectId === effect.id
                                  ? 'border-cyan-300/70 bg-cyan-300/10 text-white'
                                  : 'border-white/10 bg-white/5 text-[#d8d0df] hover:border-white/25 hover:text-white'
                              }`}
                            >
                              <span className="block text-xs font-semibold">{effect.label}</span>
                              <span className="block text-[11px] text-[#a99abf]">{effect.description}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {(error || savedNotice || loading) && (
                <div className={`rounded-sm p-4 text-sm ${sidePanelClass}`}>
                  {loading && <p className="text-[#b7aebc]">Loading profile...</p>}
                  {error && <p className="text-danger">{error}</p>}
                  {savedNotice && <p className="text-green-400">{savedNotice}</p>}
                </div>
              )}
            </aside>
          </div>
        </div>
      </main>

      {selectedBadgeShowcase && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedBadgeShowcase.label} badge preview`}
          onClick={closeBadgeShowcase}
        >
          {(selectedBadgeShowcase.backgroundSrc ?? selectedBadgeShowcase.imageSrc) && (
            <div
              className={`absolute inset-0 bg-cover bg-center opacity-0 will-change-transform ${
                badgeShowcaseClosing
                  ? 'animate-[badge-backdrop-fade_180ms_ease-in_forwards]'
                  : 'animate-[badge-backdrop-bloom_360ms_ease-out_160ms_forwards]'
              }`}
              style={{ backgroundImage: `url("${selectedBadgeShowcase.backgroundSrc ?? selectedBadgeShowcase.imageSrc}")` }}
            />
          )}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(5,8,18,0.70),rgba(41,7,42,0.82))]" />
          <button
            type="button"
            onClick={closeBadgeShowcase}
            className="absolute right-5 top-5 z-10 rounded-full border border-white/15 bg-black/45 p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close badge preview"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="relative z-10 flex max-w-[min(88vw,640px)] flex-col items-center p-6 text-center"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={selectedBadgeShowcase.imageSrc}
              alt=""
              className={`max-h-[62vh] w-auto max-w-full object-contain drop-shadow-[0_18px_28px_rgba(0,0,0,0.60)] will-change-transform ${
                badgeShowcaseClosing
                  ? 'animate-[badge-showcase-close_180ms_ease-in_forwards]'
                  : 'animate-[badge-image-pop_260ms_ease-out_both]'
              }`}
            />
            <div
              className={`${
                badgeShowcaseClosing
                  ? 'animate-[badge-info-close_150ms_ease-in_forwards]'
                  : 'animate-[badge-info-in_240ms_ease-out_430ms_both]'
              }`}
            >
              <h2 className="mt-5 text-2xl font-semibold text-white">{selectedBadgeShowcase.label}</h2>
              {selectedBadgeShowcase.description && (
                <p className="mt-2 max-w-md text-sm text-[#d8d0df]">{selectedBadgeShowcase.description}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
