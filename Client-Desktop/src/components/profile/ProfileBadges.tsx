import { Bot as BotIcon, CalendarDays, Crown, Gem, HeartHandshake, ShieldCheck, Sparkles, Star } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import type { Profile, ProfileBadge } from '../../types';

type BadgeView = {
  id: string;
  label: string;
  description: string;
  tone: NonNullable<ProfileBadge['tone']>;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  imageSrc?: string;
};

export type ProfileBadgeShowcase = {
  label: string;
  description?: string | null;
  imageSrc: string;
  backgroundSrc: string | null;
};

const TONE_CLASSES: Record<BadgeView['tone'], string> = {
  neutral: 'border-white/15 bg-white/8 text-text-secondary',
  accent: 'border-accent/55 bg-accent/15 text-accent',
  gold: 'border-yellow-300/55 bg-yellow-400/15 text-yellow-200',
  blue: 'border-cyan-300/55 bg-cyan-400/15 text-cyan-100',
  green: 'border-emerald-300/55 bg-emerald-400/15 text-emerald-100',
  pink: 'border-pink-300/55 bg-pink-400/15 text-pink-100',
  purple: 'border-violet-300/55 bg-violet-400/15 text-violet-100',
};

const GLYPH_CLASSES: Record<BadgeView['tone'], string> = {
  neutral: 'from-slate-300 to-slate-500',
  accent: 'from-accent to-cyan-300',
  gold: 'from-yellow-200 to-amber-500',
  blue: 'from-cyan-200 to-blue-500',
  green: 'from-emerald-200 to-green-600',
  pink: 'from-pink-200 to-fuchsia-500',
  purple: 'from-violet-200 to-purple-600',
};

function publicAsset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${path.replace(/^\/+/, '')}`;
}

function badgeImage(name: string) {
  return publicAsset(`badges/${name}`);
}

export function imageForProfileBadge(badge: Pick<ProfileBadge, 'id' | 'label' | 'icon'>) {
  const normalized = `${badge.id} ${badge.label} ${badge.icon ?? ''}`.toLowerCase();
  if (normalized.includes('beta')) return badgeImage('CatRealmBeta.png');
  if (normalized.includes('staff')) return badgeImage('CatRealmStaff.png');
  if (normalized.includes('supporter') || normalized.includes('sponsor')) return badgeImage('CatRealmSupporter.png');

  const yearMatch = normalized.match(/\byear[-_\s]*(\d+)\b|(\d+)[-_\s]*year/);
  const year = Number(yearMatch?.[1] ?? yearMatch?.[2] ?? 0);
  if (year > 0) return badgeImage(`CatRealmYear${Math.min(6, year)}.png`);

  return null;
}

export function backgroundForBadgeImage(imageSrc: string | null | undefined) {
  if (!imageSrc) return null;
  return imageSrc.replace(/\.png$/i, 'BG.png');
}

export function imageForYearBadge(years: number) {
  if (years < 1) return null;
  return badgeImage(`CatRealmYear${Math.min(6, years)}.png`);
}

function iconForBadge(icon: string | null | undefined) {
  const normalized = icon?.toLowerCase();
  if (normalized === 'sponsor' || normalized === 'supporter' || normalized === 'heart') return HeartHandshake;
  if (normalized === 'year' || normalized === 'anniversary') return CalendarDays;
  if (normalized === 'founder' || normalized === 'owner') return Crown;
  if (normalized === 'verified' || normalized === 'shield') return ShieldCheck;
  if (normalized === 'gem' || normalized === 'perk') return Gem;
  if (normalized === 'event' || normalized === 'sparkles') return Sparkles;
  return Star;
}

function yearsSince(timestampSeconds: number | undefined) {
  if (!timestampSeconds) return 0;
  const elapsedMs = Date.now() - timestampSeconds * 1000;
  return Math.max(0, Math.floor(elapsedMs / (365.2425 * 24 * 60 * 60 * 1000)));
}

// The year badge is an anniversary: "Year 1" means one full year completed, not
// "the first year you're in". A member with less than a full year has no year
// badge yet (imageForYearBadge returns null for tier 0).
export function yearBadgeTier(timestampSeconds: number | undefined) {
  if (!timestampSeconds) return 0;
  return yearsSince(timestampSeconds);
}

function buildBadges(profile: Profile): BadgeView[] {
  const badges = new Map<string, BadgeView>();
  const add = (badge: BadgeView) => {
    if (!badges.has(badge.id)) badges.set(badge.id, badge);
  };

  if (profile.isBot) {
    add({
      id: 'bot',
      label: 'BOT',
      description: 'This is an automated bot account on this realm.',
      tone: 'purple',
      Icon: BotIcon,
    });
  }

  if (profile.accountType === 'central') {
    add({
      id: 'central',
      label: 'Central Account',
      description: 'Uses CatRealm Central identity.',
      tone: 'blue',
      Icon: ShieldCheck,
    });
  }

  for (const badge of profile.badges ?? []) {
    const label = badge.label.trim();
    if (!badge.id || !label) continue;
    add({
      id: badge.id,
      label,
      description: badge.description?.trim() || label,
      tone: badge.tone && badge.tone in TONE_CLASSES ? badge.tone : 'accent',
      Icon: iconForBadge(badge.icon),
      imageSrc: imageForProfileBadge({ id: badge.id, label, icon: badge.icon }) ?? undefined,
    });
  }

  return Array.from(badges.values());
}

function BadgeGlyph({ id, tone, Icon, imageSrc, label }: Pick<BadgeView, 'id' | 'tone' | 'Icon' | 'imageSrc' | 'label'>) {
  if (id === 'central') {
    return <Icon className="h-3 w-3 shrink-0" />;
  }

  if (imageSrc) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/25 bg-black/25">
        <img src={imageSrc} alt="" title={label} className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/25 bg-gradient-to-br ${GLYPH_CLASSES[tone]}`}>
      <Icon className="h-2.5 w-2.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)]" />
    </span>
  );
}

export function ProfileBadges({
  profile,
  onBadgeImageClick,
}: {
  profile: Profile;
  onBadgeImageClick?: (badge: ProfileBadgeShowcase) => void;
}) {
  const badges = buildBadges(profile);
  if (badges.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {badges.map(({ id, label, description, tone, Icon, imageSrc }) => {
        const className = `inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold shadow-sm shadow-black/25 backdrop-blur-sm ${TONE_CLASSES[tone]}`;
        const content = (
          <>
            <BadgeGlyph id={id} tone={tone} Icon={Icon} imageSrc={imageSrc} label={label} />
            {label}
          </>
        );

        if (imageSrc && onBadgeImageClick) {
          return (
            <button
              key={id}
              type="button"
              title={description}
              onClick={() => onBadgeImageClick({
                label,
                description,
                imageSrc,
                backgroundSrc: backgroundForBadgeImage(imageSrc),
              })}
              className={`${className} cursor-zoom-in transition-transform hover:scale-[1.03] hover:border-white/35`}
            >
              {content}
            </button>
          );
        }

        return (
          <span key={id} title={description} className={className}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
