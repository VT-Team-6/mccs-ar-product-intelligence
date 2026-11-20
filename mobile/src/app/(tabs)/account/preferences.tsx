import { useAuth } from '@/auth/AuthContext';
import { SignInRequired } from '@/components/authentication/SignInRequired';

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { getPreferences, savePreferences } from '@/api/preferences';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { RankPicker } from '@/components/rank-picker';
import {
  DEFAULT_PREFERENCES,
  rankedCount,
  samePreferences,
  type Preferences,
} from '@/preferences/criteria';


export default function PreferencesScreen() {
  const { user } = useAuth();
  return user ? <PreferencesContent /> : <SignInRequired message="Sign in to view and save your preferences." title="Preferences" />;
}

function PreferencesContent() {
  // What is currently selected on screen
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  // What is saved on the account, so we know whether there is anything to save
  const [saved, setSaved] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Loads the saved preferences from the account. Runs on first open and on "Try again".
  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    getPreferences()
      .then((loaded) => {
        if (cancelled) return;
        setPreferences(loaded);
        setSaved(loaded);
      })
      .catch(() => {
        // Keep the defaults on screen, but don't let them overwrite the account
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const hasChanges = !samePreferences(preferences, saved);

  const change = (next: Preferences) => {
    setMessage(null);
    setPreferences(next);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await savePreferences(preferences);
      setPreferences(result);
      setSaved(result);
      setMessage('Saved to your account.');
    } catch {
      setMessage('Could not save your preferences. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setMessage(null);
    setPreferences(DEFAULT_PREFERENCES);
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title="Preferences" eyebrow="Your account" fallback="/account" />

      <View style={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          Tap what matters most to you, in order. You only need to pick one. Anything you don’t pick counts equally.
        </ThemedText>

        {loading ? (
          <ActivityIndicator />
        ) : loadFailed ? (
          <ThemedView style={styles.actions}>
            <ThemedText themeColor="textSecondary">
              Could not load your preferences.
            </ThemedText>
            <Pressable onPress={load} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="linkPrimary">Try again</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <RankPicker value={preferences} onChange={change} compact />

            <ThemedView style={styles.actions}>
              <AppButton
                label="Save Preferences"
                onPress={save}
                disabled={!hasChanges}
                loading={saving}
                style={styles.saveButton}
              />

              {rankedCount(preferences) > 0 && (
                <Pressable onPress={reset} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="linkPrimary">Clear ranking</ThemedText>
                </Pressable>
              )}

              {message && <ThemedText themeColor="textSecondary">{message}</ThemedText>}
            </ThemedView>
          </ScrollView>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.two,
  },
  list: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  actions: {
    gap: Spacing.three,
    alignItems: 'flex-start',
    paddingTop: Spacing.two,
  },
  saveButton: {
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: 0.6,
  },
});