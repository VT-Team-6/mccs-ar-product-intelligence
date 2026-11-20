import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Spacing } from '@/constants/theme';

export function SignInRequired({ message, title }: { message: string; title?: string }) {
  const { showSignIn } = useAuth();

  return (
    <ThemedView style={styles.screen}>
      {title && <ScreenHeader title={title} fallback="/" />}
      <View style={styles.content}>
        <ThemedText themeColor="textSecondary" style={styles.message}>
          {message}
        </ThemedText>
        <AppButton label="Sign in" onPress={showSignIn} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    alignItems: 'center',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  message: { textAlign: 'center' },
});
