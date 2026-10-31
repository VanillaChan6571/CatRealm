/**
 * Empty — placeholder for screens that aren't built yet. Lets the navigation
 * skeleton boot without 12 separate "Coming soon" components scattered around.
 */

import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './Text';

export interface EmptyProps {
  title: string;
  subtitle?: string;
}

export function Empty({ title, subtitle }: EmptyProps) {
  const theme = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bgApp }]}>
      <Text variant="title" color={theme.colors.text2}>
        {title}
      </Text>
      {subtitle && (
        <Text variant="bodySmall" color={theme.colors.text3} style={{ marginTop: 8, textAlign: 'center' }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
