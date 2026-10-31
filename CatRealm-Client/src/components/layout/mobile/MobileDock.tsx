import { useTranslation } from 'react-i18next';
import { Bell, Cat, Home, MessageCircle, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { AvatarImage } from '../../ui/AvatarImage';
import { AUTH_BASE } from '../../../lib/authApi';
import { resolveAvatarUrl } from '../../../utils/avatar';

export type MobileDockId = 'home' | 'servers' | 'chats' | 'notifications' | 'me';

/** Dock height without the safe-area inset; floating bars sit above it. */
export const MOBILE_DOCK_HEIGHT = 64;

const ITEMS: Array<{ id: MobileDockId; labelKey: string; Icon: LucideIcon }> = [
  { id: 'home', labelKey: 'nav.home', Icon: Home },
  { id: 'servers', labelKey: 'nav.servers', Icon: Cat },
  { id: 'chats', labelKey: 'mobile.chats', Icon: MessageCircle },
  { id: 'notifications', labelKey: 'nav.notifications', Icon: Bell },
  { id: 'me', labelKey: 'mobile.you', Icon: Home },
];

interface MobileDockProps {
  active: MobileDockId;
  badges: Partial<Record<MobileDockId, number>>;
  onPress: (id: MobileDockId) => void;
}

/** Five-up bottom navigation matching the mobile app's BottomDock. */
export function MobileDock({ active, badges, onPress }: MobileDockProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  return (
    <nav
      className="relative z-10 shrink-0 flex items-stretch border-t border-border bg-bg-sidebar"
      style={{
        height: `calc(${MOBILE_DOCK_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {ITEMS.map(({ id, labelKey, Icon }) => {
        const isActive = active === id;
        const badge = badges[id] ?? 0;
        return (
          <button
            key={id}
            type="button"
            data-tour={`dock-${id}`}
            onClick={() => onPress(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              isActive ? 'text-accent' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <span className="relative">
              {id === 'me' ? (
                <span className={`block w-[22px] h-[22px] rounded-md overflow-hidden ${isActive ? 'ring-2 ring-accent' : ''}`}>
                  <AvatarImage
                    src={resolveAvatarUrl(user?.avatar, AUTH_BASE, user?.accountType)}
                    alt={user?.username ?? 'You'}
                    size={22}
                    className="w-[22px] h-[22px] object-cover"
                    fallback={<span className="text-[11px] font-semibold">{user?.username?.charAt(0).toUpperCase()}</span>}
                  />
                </span>
              ) : (
                <Icon className="w-[22px] h-[22px]" />
              )}
              {badge > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-semibold flex items-center justify-center border-2 border-bg-sidebar">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </span>
            <span className="text-[10px] font-semibold">{t(labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
