import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type NoticeProps = {
  kind: 'success' | 'error';
  message: string;
  onDismiss?: () => void;
};

// A result that belongs next to the action that produced it, rather than in the
// page header: it stays in view while the admin works and cannot be mistaken
// for a success when it is an error.
export function FeedbackNotice({ kind, message, onDismiss }: NoticeProps) {
  const isError = kind === 'error';
  // The theme's red, brighter in dark mode so errors stay readable
  const theme = useTheme();
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.notice, isError && { borderLeftColor: theme.danger }]}
      accessibilityRole={isError ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
    >
      <ThemedText
        type="small"
        themeColor={isError ? 'danger' : undefined}
        style={styles.noticeText}
      >
        {isError ? message : `✓ ${message}`}
      </ThemedText>
      {onDismiss && (
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss this message"
          style={({ pressed }) => pressed && styles.pressed}
        >
          <ThemedText type="small" themeColor="textSecondary">
            ✕
          </ThemedText>
        </Pressable>
      )}
    </ThemedView>
  );
}

// What is happening right now. The label says which action is running, so a
// spinner in a fixed spot is never ambiguous.
export function ActionProgress({ label }: { label: string }) {
  return (
    <ThemedView
      type="backgroundElement"
      style={styles.progress}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  noticeText: {
    flex: 1,
  },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  pressed: {
    opacity: 0.4,
  },
});
