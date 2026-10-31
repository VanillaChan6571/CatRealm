/**
 * Themed Text — drop-in for RN Text with sane defaults.
 * Variants map to the type scale in `theme/typography.ts`.
 */

import { Text as RNText, TextProps, StyleSheet, TextStyle } from 'react-native';
import { useTheme } from '@/theme';

export type TextVariant =
  | 'display'
  | 'title'
  | 'subtitle'
  | 'body'
  | 'bodySmall'
  | 'caption'
  | 'mono';

export interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  weight?: '400' | '500' | '600' | '700';
  numberOfLines?: number;
}

export function Text({
  variant = 'body',
  color,
  weight,
  style,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  const variantStyle = getVariantStyle(variant, theme);
  return (
    <RNText
      style={[
        variantStyle,
        { color: color ?? theme.colors.text },
        weight ? { fontWeight: weight } : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

function getVariantStyle(variant: TextVariant, theme: ReturnType<typeof useTheme>): TextStyle {
  const { font } = theme;
  switch (variant) {
    case 'display':
      return { fontFamily: font.family.display, fontSize: font.size.display, fontWeight: '700' };
    case 'title':
      return { fontFamily: font.family.display, fontSize: font.size.lg, fontWeight: '600' };
    case 'subtitle':
      return { fontFamily: font.family.body, fontSize: font.size.base, fontWeight: '600' };
    case 'bodySmall':
      return { fontFamily: font.family.body, fontSize: font.size.sm, fontWeight: '400' };
    case 'caption':
      return { fontFamily: font.family.body, fontSize: font.size.xs, fontWeight: '500' };
    case 'mono':
      return { fontFamily: font.family.mono, fontSize: font.size.sm };
    case 'body':
    default:
      return { fontFamily: font.family.body, fontSize: font.size.base, fontWeight: '400' };
  }
}

// silence unused if RN bundler needs it
void StyleSheet;
