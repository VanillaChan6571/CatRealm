import { describe, expect, it } from 'vitest';
import type { Message } from '../../../types';
import { shouldShowMessageHeader } from '../messageGrouping';

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'message',
  channel_id: 'channel',
  user_id: 'alice',
  username: 'alice',
  avatar: null,
  content: 'Hello',
  edited: 0,
  created_at: 1000,
  ...overrides,
});

describe('channel message grouping', () => {
  it('shows the sender after a pin notice by that same user', () => {
    const notice = message({ id: 'pin', message_type: 'system', content: 'alice pinned a message.' });
    const reply = message({ id: 'reply', created_at: 1001, reply_to_id: 'original' });

    expect(shouldShowMessageHeader(reply, notice)).toBe(true);
  });

  it('still groups consecutive messages from one sender', () => {
    expect(shouldShowMessageHeader(message({ id: 'second', created_at: 1001 }), message())).toBe(false);
  });

  it('shows the sender when the author changes or the grouping window expires', () => {
    expect(shouldShowMessageHeader(message({ user_id: 'bob' }), message())).toBe(true);
    expect(shouldShowMessageHeader(message({ created_at: 1301 }), message())).toBe(true);
  });
});
