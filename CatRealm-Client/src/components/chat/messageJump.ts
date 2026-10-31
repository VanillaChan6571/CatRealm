export const CHAT_MESSAGE_JUMP_EVENT = 'catrealm:chat-message-jump';

export type ChatMessageJumpDetail = {
  channelId: string;
  messageId: string;
  timestamp?: number;
};

export function requestChatMessageJump(detail: ChatMessageJumpDetail): void {
  window.dispatchEvent(new CustomEvent<ChatMessageJumpDetail>(CHAT_MESSAGE_JUMP_EVENT, { detail }));
}
