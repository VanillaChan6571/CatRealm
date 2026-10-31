import { useState } from 'react';
import { Alert, View } from 'react-native';
import type { DMConversation } from '@/types';
import { useDMStore } from '@/stores/dmStore';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Pressable } from './Pressable';

export function DMRequestBanner({ conversation }: { conversation?: DMConversation }) {
  const theme = useTheme();
  const respond = useDMStore((s) => s.respondToRequest);
  const [busy, setBusy] = useState(false);
  if (!conversation) return null;
  const incoming = conversation.requestState === 'pending' || conversation.requestState === 'declined';
  const waiting = conversation.outgoingRequestState === 'pending';
  if (!incoming && !waiting && conversation.canSend !== false) return null;
  const decide = async (decision: 'accept' | 'decline') => {
    if (busy) return;
    setBusy(true);
    try { await respond(conversation.otherUserId, decision); }
    catch { Alert.alert('Message request', 'Could not update this request. Please try again.'); }
    finally { setBusy(false); }
  };
  return <View style={{ padding: 12, gap: 8, backgroundColor: theme.colors.bgElev1 }}>
    <Text>{incoming ? 'Accept this message request before replying.' : waiting ? 'Waiting for your message request to be accepted.' : 'Messaging is currently unavailable for this conversation.'}</Text>
    {incoming && <View style={{ flexDirection: 'row', gap: 16 }}>
      <Pressable disabled={busy} onPress={() => void decide('accept')} style={{ padding: 12 }}><Text color={theme.colors.accent}>Accept</Text></Pressable>
      {conversation.requestState === 'pending' && <Pressable disabled={busy} onPress={() => void decide('decline')} style={{ padding: 12 }}><Text>Decline</Text></Pressable>}
    </View>}
  </View>;
}
