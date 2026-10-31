import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), createApi: () => ({ get }) }));

import { mergeReadState, seedRealmReadState } from '../realmReadState';
import { useChannelStore } from '../../stores/channelStore';
import { useServerStore } from '../../stores/serverStore';

const unread = (unreadCount: number, muted = false) => ({ unread: true, unreadCount, muted });
const read = { unread: false, unreadCount: 0, muted: false };

describe('mergeReadState', () => {
  it('takes the larger count, clears read channels, and skips muted and open ones', () => {
    expect(mergeReadState(
      { a: 5, b: 2, c: 3 },
      { a: unread(2), b: unread(7), c: read, d: unread(1, true), open: unread(4) },
      'open',
    )).toEqual({ a: 5, b: 7, c: 0, d: 0 });
  });
});

describe('seedRealmReadState', () => {
  beforeEach(() => {
    get.mockReset();
    useChannelStore.setState({ unreadByChannel: {}, activeChannelId: 'open' });
    useServerStore.setState({ activeServerUrl: 'https://active.example', snapshots: {} });
  });

  it('seeds the open realm into the channel list and other realms into their snapshot', async () => {
    get.mockResolvedValue({ data: { channels: { a: unread(3), open: unread(1) } } });
    await seedRealmReadState('https://active.example', 't');
    expect(useChannelStore.getState().unreadByChannel).toEqual({ a: 3 });

    await seedRealmReadState('https://other.example', 't');
    expect(useServerStore.getState().snapshots['https://other.example'].unreadByChannel).toEqual({ a: 3, open: 1 });
  });

  it('throttles repeat seeds and stops asking realms that lack the endpoint', async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    await seedRealmReadState('https://old.example', 't');
    await seedRealmReadState('https://old.example', 't');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
