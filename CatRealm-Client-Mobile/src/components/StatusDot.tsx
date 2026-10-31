/**
 * StatusDot — tiny circle showing online/away/sleeping/invisible.
 * Used standalone in lists; Avatar already embeds one when `showStatus`.
 */

import { View, ViewStyle, StyleProp } from 'react-native';
import { useTheme } from '@/theme';
import type { UserStatus } from '@/types';

export interface StatusDotProps {
  status: UserStatus;
  size?: number;
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatusDot({ status, size = 10, ringColor, style }: StatusDotProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.statusColor[status],
          borderWidth: ringColor ? 2 : 0,
          borderColor: ringColor ?? 'transparent',
        },
        style,
      ]}
    />
  );
}
