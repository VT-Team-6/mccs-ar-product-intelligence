import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthContext';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

export default function AccountScreen() {
  const { profile, isAdmin, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Tracks the "Try again" press, and makes the automatic retry happen once
  const [retrying, setRetrying] = useState(false);
  const attempted = useRef(false);

  // Refresh the profile on first load, if we haven't already loaded it. This is important for the case where the user has just signed in and we haven't yet asked the backend who they are.
  useEffect(() => {
    if (isAdmin !== undefined || attempted.current) return;
    attempted.current = true;
    refreshProfile();
  }, [isAdmin, refreshProfile]);

  const retry = async () => {
    setRetrying(true);
    await refreshProfile();
    setRetrying(false);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ThemedView style={styles.header}>
          <ThemedText type="subtitle">Account</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {profile?.email ?? ''}
          </ThemedText>
        </ThemedView>

        <ScrollView
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}>
          {isAdmin && (
            <Row
              label="Admin"
              hint="Add, edit and delete products"
              onPress={() => router.push('/admin')}
            />
          )}

          {/* Admin Access */}
          {isAdmin === undefined && (
            <Pressable
              onPress={retry}
              disabled={retrying}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <ThemedView type="backgroundElement" style={styles.rowText}>
                  <ThemedText type="smallBold">Could not load your account</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {retrying ? 'Trying again…' : 'Tap to try again'}
                  </ThemedText>
                </ThemedView>
                {retrying && <ActivityIndicator />}
              </ThemedView>
            </Pressable>
          )}

          <Row label="Sign out" onPress={signOut} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedView type="backgroundElement" style={styles.rowText}>
          <ThemedText type="smallBold">{label}</ThemedText>
          {hint && (
            <ThemedText type="small" themeColor="textSecondary">
              {hint}
            </ThemedText>
          )}
        </ThemedView>
        <ThemedText themeColor="textSecondary">›</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    // On web the tab bar sits at the top, so leave room for it
    paddingTop: Platform.OS === 'web' ? Spacing.six + Spacing.four : Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  header: {
    gap: Spacing.half,
  },
  list: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.6,
  },
});
