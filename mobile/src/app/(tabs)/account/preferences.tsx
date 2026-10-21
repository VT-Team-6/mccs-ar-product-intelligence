import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getPreferences, savePreferences } from '@/api/preferences';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { RankPicker } from '@/components/rank-picker';
import {
  DEFAULT_PREFERENCES,
  rankedCount,
  samePreferences,
  type Preferences,
} from '@/preferences/criteria';

// The blue used for links elsewhere in the app
const ACCENT = '#3c87f7';

export default function PreferencesScreen() {
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
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ThemedText type="subtitle">Preferences</ThemedText>
        <ThemedText themeColor="textSecondary">
            Tap what matters most to you, in order. You only need to pick one; anything you don’t pick counts equally.
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
            <RankPicker value={preferences} onChange={change} />

            <ThemedView style={styles.actions}>
              <Pressable
                onPress={save}
                disabled={!hasChanges || saving}
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: ACCENT },
                  (!hasChanges || saving) && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                  {saving ? 'Saving…' : 'Save preferences'}
                </ThemedText>
              </Pressable>

              {rankedCount(preferences) > 0 && (
                <Pressable onPress={reset} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="linkPrimary">Clear ranking</ThemedText>
                </Pressable>
              )}

              {message && <ThemedText themeColor="textSecondary">{message}</ThemedText>}
            </ThemedView>
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
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
    paddingHorizontal: Spacing.four,
    // On web the tab bar sits at the top, so leave room for it
    paddingTop: Platform.OS === 'web' ? Spacing.six + Spacing.four : Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
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
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});