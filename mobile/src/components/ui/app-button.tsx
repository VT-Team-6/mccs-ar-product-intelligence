import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// The app's one button. Use it instead of styling a Pressable by hand, so every
// screen has the same sizes, colors and pressed/disabled looks.
//
// primary:   red, for the main action on a screen (Scan, Search, Save, Compare)
// secondary: navy outline, for the other actions next to it
// danger:    red outline, for actions that remove something
type Variant = 'primary' | 'secondary' | 'danger';

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  // Shows a spinner and blocks presses while something is in progress
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const inactive = disabled || loading;
  const filled = variant === 'primary';
  const outline = variant === 'danger' ? Brand.danger : theme.link;
  const textColor = filled ? '#ffffff' : outline;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        filled
          ? { backgroundColor: Brand.red }
          : { backgroundColor: theme.background, borderColor: outline, borderWidth: 2 },
        inactive && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <ThemedText style={[styles.label, { color: textColor }]}>{label}</ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 800,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
});