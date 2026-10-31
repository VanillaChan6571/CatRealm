import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { AUTH_BASE } from '../../lib/authApi';
import { usePresenceStore } from '../../stores/presenceStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { resolveAvatarUrl } from '../../utils/avatar';
import { resolveDisplayName } from '../../utils/displayName';
import { getRoleNameStyle } from '../../lib/roleStyles';
import { AvatarImage } from '../ui/AvatarImage';
import { MessageFormatter } from './MessageFormatter';

/**
 * Cat Lab — live self-view of the message currently being typed. Renders only
 * for the local user (never sent anywhere) so they can see how their message
 * will look, including emotes, before sending. Gated behind the
 * `catLabTextPreview` setting and only shown while there is text to preview.
 */
export function ComposerSelfPreview({ content }: { content: string }) {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.catLabTextPreview);
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const selfId = user ? (user.serverUserId ?? user.id) : null;
  const liveUser = usePresenceStore((s) =>
    selfId ? s.onlineUsers.find((u) => u.id === selfId) ?? null : null
  );

  const trimmed = content.trim();
  if (!enabled || !user || trimmed.length === 0) return null;

  const authorName = resolveDisplayName(selfId ?? user.id, user.username, user.displayName);
  // Central accounts store their avatar on the central auth server, not the
  // active self-hostable server — resolve against the right base + accountType.
  const avatarBase = user.accountType === 'central' ? AUTH_BASE : serverUrl;
  const avatarUrl = resolveAvatarUrl(user.avatar, avatarBase, user.accountType) ?? '';
  const nameColor = liveUser?.roleColor ?? undefined;

  return (
    <div className="mb-2 rounded-lg border border-border bg-bg-elevated/60 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border/60 bg-bg-hover/30 text-[11px] text-text-muted select-none">
        <Eye className="h-3 w-3" />
        <span>{t('settingsContent.composerTextPreviewLabel')}</span>
      </div>
      <div className="flex gap-3 px-3 py-2">
        <div className="w-9 h-9 rounded-full avatar-bg-muted flex items-center justify-center text-white text-sm font-semibold shrink-0 overflow-hidden">
          <AvatarImage
            src={avatarUrl}
            alt={authorName}
            size={36}
            className="w-full h-full object-cover"
            fallback={<span>{authorName.charAt(0).toUpperCase()}</span>}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-sm" style={getRoleNameStyle(nameColor, liveUser?.roleStyleType, liveUser?.roleStyleColors)}>
              {authorName}
            </span>
          </div>
          <div className="text-sm text-text-primary break-words whitespace-pre-wrap">
            <MessageFormatter text={content} allowLinks={false} allowEmbeds={false} serverUrl={serverUrl} />
          </div>
        </div>
      </div>
    </div>
  );
}
