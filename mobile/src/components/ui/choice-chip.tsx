import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

// A one-of-several choice (category, fit). The chosen one is filled navy with
// white text and an outline, so it stands out in light and dark mode; the rest
// stay plain grey.
export function ChoiceChip({ label, selected, onPress }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected
          ? { backgroundColor: Brand.navy, borderColor: theme.link }
          : { backgroundColor: theme.backgroundElement, borderColor: 'transparent' },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" style={selected && styles.selectedText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 2,
  },
  selectedText: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.7,
  },
});
