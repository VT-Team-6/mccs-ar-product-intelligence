import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';

// Small navy capitals that name a section, e.g. TODAY or PRICE
export function SectionLabel({ label, style }: { label: string; style?: StyleProp<TextStyle> }) {
  return (
    <ThemedText themeColor="link" style={[styles.label, style]}>
      {label.toUpperCase()}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});