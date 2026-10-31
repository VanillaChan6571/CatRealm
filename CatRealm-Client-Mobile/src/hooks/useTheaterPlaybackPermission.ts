import { useTheaterStore } from '@/stores/theaterStore';
import { useServerStore } from '@/stores/serverStore';
import { canControlTheater } from '@/lib/theaterPermissions';

export function useTheaterPlaybackPermission(serverId: string | null, channelId: string | null) {
  const realmUser = useTheaterStore((s) => s.realmUser);
  const selfId = useTheaterStore((s) => s.selfTheaterUserId);
  const hostId = useTheaterStore((s) => s.hostUserId ?? s.playbackState?.host_user_id ?? null);
  const joined = useTheaterStore((s) => !!channelId && s.channelId === channelId && s.serverId === serverId);
  const permissions = useServerStore((s) => serverId
    ? s.channels[serverId]?.find((channel) => channel.id === channelId)?.effective_permissions : undefined);
  return joined && canControlTheater(realmUser, permissions, hostId, selfId);
}
