import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export type FailureRetry = {
  /** e.g. "Try upload again" — says what will happen, not just "Retry". */
  label: string;
  run: () => void;
};

export type Failure = {
  title: string;
  message: string;
  /** Omitted when repeating the action would not help (e.g. a bad link). */
  retry?: FailureRetry;
};

type Props = {
  /** Rendered as a popup while set; closing it clears it in the caller. */
  failure: Failure | null;
  onClose: () => void;
};

// A failure worth interrupting for: it names what failed, repeats the backend's
// reason, and offers to run the same action again.
export function FailureDialog({ failure, onClose }: Props) {
  return (
    <Modal
      visible={failure !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => {}} accessibilityViewIsModal>
          <ThemedView style={styles.card}>
            <ThemedText type="smallBold" style={styles.title}>
              {failure?.title ?? ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {failure?.message ?? ''}
            </ThemedText>

            <View style={styles.actions}>
              {failure?.retry && (
                <Pressable
                  onPress={() => {
                    const retry = failure.retry;
                    onClose();
                    retry?.run();
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.button, pressed && styles.pressed]}
                >
                  <ThemedView type="backgroundSelected" style={styles.buttonView}>
                    <ThemedText type="smallBold">{failure.retry.label}</ThemedText>
                  </ThemedView>
                </Pressable>
              )}
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                <ThemedView type="backgroundElement" style={styles.buttonView}>
                  <ThemedText type="small">Close</ThemedText>
                </ThemedView>
              </Pressable>
            </View>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: 320,
    maxWidth: '100%',
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  button: {
    flexGrow: 1,
    flexBasis: '40%',
  },
  buttonView: {
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.4,
  },
});
