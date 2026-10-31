import { useChannelStore } from '../stores/channelStore';

export function getViewedChannelsSnapshot() {
  return useChannelStore.getState().channels;
}

export function useViewedChannels() {
  return useChannelStore((s) => s.channels);
}
