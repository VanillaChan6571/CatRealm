/**
 * IconBtn — circular tap-target with a lucide icon. Use in headers, sheets,
 * inline message actions, etc. Default size hits the 44pt target.
 */

import { View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Pressable } from './Pressable';

export interface IconBtnProps {
  icon: LucideIcon;
  onPress?: () => void;
  size?: number;
  variant?: 'ghost' | 'filled' | 'accent';
  badge?: number;
  disabled?: boolean;
  haptic?: boolean;
  accessibilityLabel?: string;
}

export function IconBtn({
  icon: Icon,
  onPress,
  size = 22,
  variant = 'ghost',
  disabled,
  haptic,
  accessibilityLabel,
}: IconBtnProps) {
  const theme = useTheme();
  const hit = theme.hit.min;
  const bg =
    variant === 'filled'
      ? theme.colors.bgElev2
      : variant === 'accent'
        ? theme.colors.accent
        : 'transparent';
  const fg = variant === 'accent' ? theme.colors.textOnAccent : theme.colors.text2;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: hit,
        height: hit,
        borderRadius: hit / 2,
        backgroundColor: bg,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <View pointerEvents="none">
        <Icon size={size} color={fg} />
      </View>
    </Pressable>
  );
}
