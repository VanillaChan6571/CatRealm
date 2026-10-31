import { Clapperboard, SkipForward, Users } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useTheaterStore } from '../../stores/theaterStore';
import { useUIStore } from '../../stores/uiStore';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import { PERMISSIONS, hasChannelPermission, hasPermission } from '../../utils/permissions';

export function TheaterFloatingBar() {
  const user = useAuthStore((s) => s.user);
  const activeChannelId = useTheaterStore((s) => s.activeChannelId);
  const channelName = useTheaterStore((s) => s.theaterChannelName);
  const state = useTheaterStore((s) => s.state);
  const queue = useTheaterStore((s) => s.queue);
  const users = useTheaterStore((s) => s.users);
  const hostUserId = useTheaterStore((s) => s.hostUserId);
  const selfUserId = useTheaterStore((s) => s.selfUserId);
  const skipCurrent = useTheaterStore((s) => s.skipCurrent);
  const theaterSidePanelRetracted = useUIStore((s) => s.theaterSidePanelRetracted);
  const toggleTheaterSidePanelRetracted = useUIStore((s) => s.toggleTheaterSidePanelRetracted);
  const channels = useViewedChannels();

  const activeChannel = channels.find((channel) => channel.id === activeChannelId);
  const channelPerms = activeChannel?.effective_permissions ?? 0;
  const currentItem = state?.current_item_id
    ? (queue.find((item) => item.id === state.current_item_id) ?? null)
    : null;
  const currentTitle = currentItem?.title ?? (state?.videoUrl ? 'Playing video' : 'Nothing playing');
  const viewerCount = users.length;
  const canControl = !!activeChannel && (
    hasPermission(user?.permissions, PERMISSIONS.MANAGE_CHANNELS)
    || hasChannelPermission(
    user?.permissions,
      channelPerms,
      PERMISSIONS.PLAY_IN_THEATER,
    )
    || hostUserId === selfUserId
  );

  if (!activeChannelId) return null;

  return (
    <div
      className="fixed right-4 top-4 z-50 max-w-[calc(100vw-2rem)]"
      data-debug-name="Theater Floating Bar"
      data-debug-file="src/components/layout/TheaterFloatingBar.tsx"
    >
      <div className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-bg-elevated/95 px-3 py-2 shadow-lg backdrop-blur">
        <Clapperboard className="h-4 w-4 shrink-0 text-text-muted" />
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="max-w-[160px] truncate font-semibold text-text-primary">
            {channelName ?? 'Theater'}
          </span>
          <span className="text-text-muted">-</span>
          <span className="max-w-[min(28rem,42vw)] truncate text-text-secondary">
            {currentTitle}
          </span>
          <span className="text-text-muted">-</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-text-muted">
            <Users className="h-3.5 w-3.5" />
            {viewerCount}
          </span>
        </div>

        <div className="h-5 w-px shrink-0 bg-border" />

        {canControl && state?.current_item_id && (
          <button
            data-debug-name="Theater Floating Bar: Skip"
            data-debug-file="src/components/layout/TheaterFloatingBar.tsx"
            onClick={() => { void skipCurrent(activeChannelId); }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-bg-hover px-3 text-xs font-semibold text-text-primary transition-colors hover:bg-bg-input"
            title="Skip"
            aria-label="Skip current theater item"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Skip
          </button>
        )}

        <button
          data-debug-name="Theater Floating Bar: Hide Panel"
          data-debug-file="src/components/layout/TheaterFloatingBar.tsx"
          onClick={toggleTheaterSidePanelRetracted}
          className="h-8 shrink-0 rounded-full bg-bg-hover px-3 text-xs font-semibold text-text-primary transition-colors hover:bg-bg-input"
          title={theaterSidePanelRetracted ? 'Show Theater Side Panel' : 'Hide Theater Side Panel'}
          aria-label={theaterSidePanelRetracted ? 'Show Theater side panel' : 'Hide Theater side panel'}
        >
          {theaterSidePanelRetracted ? 'Show Panel' : 'Hide Panel'}
        </button>
      </div>
    </div>
  );
}
