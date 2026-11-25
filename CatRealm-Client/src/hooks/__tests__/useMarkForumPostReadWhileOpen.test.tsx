import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const background = vi.hoisted(() => ({ value: false }));
vi.mock('../../lib/desktopNotifications', () => ({
  isAppInBackground: () => background.value,
  dismissDesktopNotifications: vi.fn(),
}));

import { useChannelStore } from '../../stores/channelStore';
import { useThreadStore } from '../../stores/threadStore';
import { useMarkForumPostReadWhileOpen } from '../useMarkForumPostReadWhileOpen';

function PostStandIn() {
  useMarkForumPostReadWhileOpen('forum', 'first');
  return null;
}

describe('useMarkForumPostReadWhileOpen', () => {
  const markForumPostRead = vi.fn(async () => {});
  const setChannelPrefs = vi.fn(async () => {});

  beforeEach(() => {
    background.value = false;
    markForumPostRead.mockClear();
    setChannelPrefs.mockClear();
    useChannelStore.setState({
      unreadByChannel: { forum: 2 },
      atBottomByChannel: { forum: true },
      setChannelPrefs,
    });
    useThreadStore.setState({ activeForumPostId: null, markForumPostRead });
  });

  afterEach(cleanup);

  it('reads the opened post without advancing the channel read position', () => {
    render(<PostStandIn />);
    expect(markForumPostRead).toHaveBeenCalledWith('forum', 'first');
    expect(setChannelPrefs).not.toHaveBeenCalled();
    expect(useChannelStore.getState().atBottomByChannel.forum).toBe(false);
    expect(useChannelStore.getState().unreadByChannel.forum).toBe(2);
    expect(useThreadStore.getState().activeForumPostId).toBe('first');
  });

  it('waits until the app is visible before reading the post', () => {
    background.value = true;
    render(<PostStandIn />);
    expect(markForumPostRead).not.toHaveBeenCalled();
    background.value = false;
    window.dispatchEvent(new Event('focus'));
    expect(markForumPostRead).toHaveBeenCalledTimes(1);
  });
});
