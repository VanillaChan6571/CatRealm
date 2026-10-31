import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VoiceChannelContent } from '@/components/VoiceChannelContent';

export default function VoiceScreen() {
  const { channelId, serverId } = useLocalSearchParams<{ channelId: string; serverId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <VoiceChannelContent
      channelId={channelId ?? ''}
      serverId={serverId ?? ''}
      onClose={() => router.dismiss()}
      topInset={insets.top}
      bottomInset={insets.bottom}
    />
  );
}
