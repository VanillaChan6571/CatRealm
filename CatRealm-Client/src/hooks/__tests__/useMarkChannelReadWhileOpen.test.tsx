import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const background = vi.hoisted(() => ({ value: false }));
vi.mock('../../lib/desktopNotifications', () => ({
  isAppInBackground: () => background.value,
  dismissDesktopNotifications: vi.fn(),
}));

import { useChannelStore } from '../../stores/channelStore';
import { useMarkChannelReadWhileOpen } from '../useMarkChannelReadWhileOpen';

function ForumStandIn({ channelId }: { channelId: string }) {
  useMarkChannelReadWhileOpen(channelId);
  return null;
}

describe('useMarkChannelReadWhileOpen', () => {
  const setChannelPrefs = vi.fn(async () => {});

  beforeEach(() => {
    background.value = false;
    setChannelPrefs.mockClear();
    useChannelStore.setState({
      unreadByChannel: { forum: 4, other: 2 },
      mentionByChannel: { forum: 1, other: 0 },
      atBottomByChannel: {},
      setChannelPrefs,
    });
  });

  afterEach(cleanup);

  it('clears the badge and saves the read position when the forum opens', () => {
    render(<ForumStandIn channelId="forum" />);
    const state = useChannelStore.getState();
    expect(state.unreadByChannel).toEqual({ forum: 0, other: 2 });
    expect(state.mentionByChannel.forum).toBe(0);
    expect(state.atBottomByChannel.forum).toBe(true);
    expect(setChannelPrefs).toHaveBeenCalledWith('forum', { lastReadAt: expect.any(Number) });
  });

  it('waits for the app to return to the foreground', () => {
    background.value = true;
    render(<ForumStandIn channelId="forum" />);
    expect(useChannelStore.getState().unreadByChannel.forum).toBe(4);
    expect(setChannelPrefs).not.toHaveBeenCalled();

    background.value = false;
    window.dispatchEvent(new Event('focus'));
    expect(useChannelStore.getState().unreadByChannel.forum).toBe(0);
    expect(setChannelPrefs).toHaveBeenCalledTimes(1);
  });
});
