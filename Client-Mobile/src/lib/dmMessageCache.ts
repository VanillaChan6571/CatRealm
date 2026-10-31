import type { DMMessage } from '@/types';

/**
 * Merge a server page into the in-memory DM history.
 *
 * A non-paginated fetch is also the retry path for failed decryption. Failed
 * placeholders outside that fresh page cannot be retried by the response and
 * must not keep the conversation-wide recovery banner alive forever. They can
 * be fetched again normally when the user pages back through history.
 */
export function mergeDMMessagePage(
  existing: DMMessage[],
  fetched: DMMessage[],
  paginating: boolean,
): DMMessage[] {
  const retained = paginating
    ? existing
    : existing.filter((message) => message.systemType !== 'decrypt_failed');
  const byId = new Map(retained.map((message) => [message.id, message]));
  for (const message of fetched) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}
