import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  // "some" shows a dash: part of a group is checked
  checked: boolean | 'some';
  onPress: () => void;
  label: string;
};

// A square checkbox: navy with a white check when on, a dash when part of a
// group is on, an empty outline when off
export function Checkbox({ checked, onPress, label }: Props) {
  const theme = useTheme();
  const on = checked !== false;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: checked === 'some' ? 'mixed' : checked }}
      accessibilityLabel={label}
      style={[
        styles.box,
        { borderColor: on ? theme.link : theme.textSecondary },
        on && { backgroundColor: Brand.navy },
      ]}>
      {on && <ThemedText style={styles.mark}>{checked === 'some' ? '–' : '✓'}</ThemedText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '700',
  },
});
