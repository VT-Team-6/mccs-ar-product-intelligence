import { useEffect, useId, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  value: number;
  // Called with the typed number once typing ends, kept within min..max
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  // Report each valid number as it's typed (a form), not only when typing
  // ends (a list row that saves on change)
  live?: boolean;
  accessibilityLabel: string;
  style?: StyleProp<TextStyle>;
};

// The number between − and +, which can also be tapped and typed (for 10,
// say, instead of pressing + ten times). The iPhone number pad has no Done
// key, so a Done bar sits above it; Android's keyboard has its own.
export function QuantityField({ value, onChange, min = 1, max = 99, disabled, live, accessibilityLabel, style }: Props) {
  const theme = useTheme();
  const doneId = `quantity-${useId()}`;
  const [text, setText] = useState(String(value));

  // Follow changes made with − / +
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const typed = parseInt(text, 10);
    const next = Number.isNaN(typed) ? value : Math.min(max, Math.max(min, typed));
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <>
      <TextInput
        value={text}
        onChangeText={(typed) => {
          const digits = typed.replace(/[^0-9]/g, '').slice(0, String(max).length);
          setText(digits);
          const number = parseInt(digits, 10);
          if (live && number >= min && number <= max) onChange(number);
        }}
        onEndEditing={commit}
        onSubmitEditing={commit}
        editable={!disabled}
        keyboardType="number-pad"
        returnKeyType="done"
        selectTextOnFocus
        inputAccessoryViewID={Platform.OS === 'ios' ? doneId : undefined}
        accessibilityLabel={accessibilityLabel}
        style={[styles.input, { color: theme.text }, style]}
      />
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={doneId}>
          <View style={[styles.doneBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10} accessibilityRole="button">
              <ThemedText type="linkPrimary">Done</ThemedText>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  input: {
    minWidth: 32,
    paddingVertical: 2,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
  },
  doneBar: {
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
