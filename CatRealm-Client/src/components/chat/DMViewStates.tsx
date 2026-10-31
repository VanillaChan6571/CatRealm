type DMEmptyConversationStateProps = {
  text?: string;
};

export function DMEmptyConversationState({
  text = 'Select a conversation to start messaging',
}: DMEmptyConversationStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-muted">
      <div className="text-center">
        <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p className="text-lg">{text}</p>
      </div>
    </div>
  );
}

type DMMessageListStatusProps = {
  loadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  hasMessages: boolean;
};

export function DMMessageListStatus({
  loadingOlderMessages,
  hasOlderMessages,
  hasMessages,
}: DMMessageListStatusProps) {
  return (
    <>
      {(loadingOlderMessages || hasOlderMessages) && hasMessages && (
        <div className="px-6 pb-2 text-center text-xs text-text-muted">
          {loadingOlderMessages ? 'Loading older messages...' : 'Scroll up to load older messages'}
        </div>
      )}
      {!hasMessages && (
        <div className="text-center text-text-muted py-8">
          <p>No messages yet. Start the conversation!</p>
        </div>
      )}
    </>
  );
}
