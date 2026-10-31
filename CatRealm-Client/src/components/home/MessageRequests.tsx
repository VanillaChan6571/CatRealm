import { useDMStore } from '../../stores/dmStore';
import { DMRequestActions } from '../chat/DMRequestActions';

export function MessageRequests({ onOpen }: { onOpen: () => void }) {
  const conversations = useDMStore(s => s.conversations);
  const requests = conversations.filter(c => c.requestState === 'pending' || c.requestState === 'declined');
  return <section className="flex-1 p-6 overflow-y-auto space-y-4">
    <h2 className="text-xl font-semibold">Message requests</h2>
    <p className="text-sm text-text-muted">These messages do not trigger normal DM notifications. Previewing a request does not accept it.</p>
    {!requests.length && <p>No message requests.</p>}
    {requests.map(request => <article key={request.id} className="rounded border border-border">
      <button className="p-3 text-accent" onClick={() => {
        void useDMStore.getState().openConversation(request.otherUserId, request.otherUsername, request.otherAvatar).then(onOpen);
      }}>{request.otherDisplayName || request.otherUsername} — Preview</button>
      <DMRequestActions otherUserId={request.otherUserId} declined={request.requestState === 'declined'} />
    </article>)}
  </section>;
}
