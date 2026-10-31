import type { DMMessage } from '@/types';
import { mergeDMMessagePage } from '../dmMessageCache';

function message(id: string, createdAt: number, systemType: string | null = null): DMMessage {
  return {
    id,
    conversationId: 'dm',
    senderId: 'alice',
    recipientId: 'bob',
    text: id,
    messageType: systemType ? 'system' : 'user',
    systemType,
    systemData: null,
    attachments: null,
    nsfwTags: [],
    reactions: [],
    createdAt,
    delivered: true,
    read: false,
  };
}

test('a fresh DM page removes stale decrypt failures outside the fetched page', () => {
  const staleFailure = message('old-failure', 1, 'decrypt_failed');
  const olderReadable = message('older-readable', 2);
  const latestReadable = message('latest-readable', 3);

  expect(mergeDMMessagePage([staleFailure, olderReadable], [latestReadable], false))
    .toEqual([olderReadable, latestReadable]);
});

test('pagination keeps failures from previously loaded pages', () => {
  const failure = message('failure', 2, 'decrypt_failed');
  const olderReadable = message('older-readable', 1);

  expect(mergeDMMessagePage([failure], [olderReadable], true))
    .toEqual([olderReadable, failure]);
});

test('a successfully decrypted server message replaces its failed placeholder', () => {
  const failure = message('same-id', 1, 'decrypt_failed');
  const readable = message('same-id', 1);

  expect(mergeDMMessagePage([failure], [readable], false)).toEqual([readable]);
});
