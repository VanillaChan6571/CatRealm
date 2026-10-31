import { View } from 'react-native';
import { Bot } from 'lucide-react-native';
import { Text } from './Text';

export function BotBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const compact = size === 'sm';
  return (
    <View
      accessibilityLabel="Bot account"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: compact ? 2 : 3,
        borderRadius: 4,
        paddingHorizontal: compact ? 4 : 6,
        paddingVertical: compact ? 1 : 2,
        backgroundColor: '#4F46E5',
      }}
    >
      <Bot size={compact ? 9 : 11} color="#FFFFFF" strokeWidth={2.5} />
      <Text
        variant="caption"
        color="#FFFFFF"
        style={{ fontSize: compact ? 8 : 10, lineHeight: compact ? 10 : 12, fontWeight: '800', letterSpacing: 0.4 }}
      >
        BOT
      </Text>
    </View>
  );
}
