import type { Message } from '../../types';

/** System events interrupt the visual grouping of ordinary chat messages. */
export function shouldShowMessageHeader(message: Message, previous?: Message): boolean {
  return !previous ||
    previous.message_type === 'system' ||
    message.message_type === 'system' ||
    previous.user_id !== message.user_id ||
    message.created_at - previous.created_at > 300;
}
