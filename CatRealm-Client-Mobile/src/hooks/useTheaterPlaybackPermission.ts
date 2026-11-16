import { useTheaterStore } from '@/stores/theaterStore';
import { useServerStore } from '@/stores/serverStore';
import { canControlTheater } from '@/lib/theaterPermissions';

export function useTheaterPlaybackPermission(serverId: string | null, channelId: string | null) {
  const realmUser = useTheaterStore((s) => s.realmUser);
  const selfId = useTheaterStore((s) => s.selfTheaterUserId);
  const hostId = useTheaterStore((s) => s.hostUserId ?? s.playbackState?.host_user_id ?? null);
  const joined = useTheaterStore((s) => !!channelId && s.channelId === channelId && s.serverId === serverId);
  const channel = useServerStore((s) => serverId
    ? s.channels[serverId]?.find((item) => item.id === channelId) : undefined);
  return joined && canControlTheater(realmUser, channel?.effective_permissions, hostId, selfId, channel?.effective_permission_keys);
}
