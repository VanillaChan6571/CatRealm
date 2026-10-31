import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { createApi } from '@/lib/api';
import { useServerStore, type MobileServer } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import type { Category, Channel } from '@/types';

/**
 * Make a server active and open its remembered channel, or its first
 * non-voice channel, loading the channel list first if needed.
 */
export function useOpenServer() {
  const router = useRouter();
  return useCallback(async (server: MobileServer) => {
    let serverChannels = useServerStore.getState().channels[server.id] ?? [];
    if (serverChannels.length === 0) {
      const api = createApi(server.url, server.token || undefined);
      const [channelsRes, categoriesRes] = await Promise.all([
        api.get<Channel[]>('/api/channels'),
        api.get<Category[]>('/api/categories'),
      ]);
      serverChannels = channelsRes.data ?? [];
      useServerStore.getState().setChannels(server.id, serverChannels);
      useServerStore.getState().setCategories(server.id, categoriesRes.data ?? []);
    }

    await useServerStore.getState().setActiveServer(server.id);
    const rememberedChannelId = useChannelStore.getState().lastChannelByServer[server.id] ?? null;
    const firstChannelId =
      serverChannels
        .slice()
        .sort((a, b) => a.position - b.position)
        .find((channel) => channel.type !== 'voice')?.id ??
      serverChannels[0]?.id ??
      null;
    const targetChannelId = rememberedChannelId || firstChannelId;
    if (targetChannelId) {
      router.replace({
        pathname: '/server/[serverId]/channel/[channelId]',
        params: { serverId: server.id, channelId: targetChannelId },
      });
    }
  }, [router]);
}
