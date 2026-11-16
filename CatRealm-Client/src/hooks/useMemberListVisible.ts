import { useChannelStore } from '../stores/channelStore';
import { useUIStore } from '../stores/uiStore';

/**
 * Whether the realm member list should be on screen. Tracker and Board channels need the
 * full width, so the list slides away while one is open and returns with any other channel.
 * The user's own show/hide preference is left untouched.
 */
export function useMemberListVisible(): boolean {
  const memberListOpen = useUIStore((s) => s.memberListOpen);
  const wideChannelOpen = useChannelStore((s) => {
    const type = s.channels.find((channel) => channel.id === s.activeChannelId)?.type;
    return type === 'tracker' || type === 'board';
  });
  return memberListOpen && !wideChannelOpen;
}
