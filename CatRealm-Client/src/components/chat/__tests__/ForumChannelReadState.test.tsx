import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Channel } from '../../../types';

vi.mock('../../../hooks/useViewedPermissions', () => ({
  useViewedPermissions: () => ({ permissions: 0 }),
}));

import { useChannelStore } from '../../../stores/channelStore';
import { useThreadStore } from '../../../stores/threadStore';
import { ForumChannel } from '../ForumChannel';

describe('ForumChannel read state', () => {
  const setChannelPrefs = vi.fn(async () => {});
  const fetchForumPosts = vi.fn(async () => {});
  const channel = { id: 'forum', name: 'Forum', type: 'forum' } as Channel;

  beforeEach(() => {
    setChannelPrefs.mockClear();
    fetchForumPosts.mockClear();
    useChannelStore.setState({
      activeChannelId: 'forum',
      unreadByChannel: { forum: 2 },
      atBottomByChannel: { forum: true },
      setChannelPrefs,
    });
    useThreadStore.setState({ forumPostsByChannel: {}, fetchForumPosts });
  });

  afterEach(cleanup);

  it('keeps posts unread when the list opens or the window regains focus', () => {
    render(<ForumChannel channel={channel} onOpenPost={() => {}} />);
    expect(fetchForumPosts).toHaveBeenCalledWith('forum');
    expect(useChannelStore.getState().unreadByChannel.forum).toBe(2);
    expect(useChannelStore.getState().atBottomByChannel.forum).toBe(false);
    expect(setChannelPrefs).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('focus'));
    expect(useChannelStore.getState().unreadByChannel.forum).toBe(2);
    expect(setChannelPrefs).not.toHaveBeenCalled();
  });
});
