import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  CRITERIA,
  DEFAULT_PREFERENCES,
  IMPORTANCE_LEVELS,
  parsePreferences,
  samePreferences,
  type CriterionKey,
  type Importance,
  type Preferences,
} from '@/preferences/criteria';

// Preferences are only kept on this device for now.
// Later they will be saved to the user's account through the backend.
const STORAGE_KEY = 'preferences';

// The blue used for links elsewhere in the app
const ACCENT = '#3c87f7';

export default function PreferencesScreen() {
  const theme = useTheme();
  // What is currently selected on screen
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  // What was last saved, so we know whether there is anything to save
  const [saved, setSaved] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  // Loads the saved preferences when the screen first opens
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        const loaded = parsePreferences(raw);
        setPreferences(loaded);
        setSaved(loaded);
      })
      .catch(() => {
        // If reading fails we just start from the defaults
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasChanges = !samePreferences(preferences, saved);

  const choose = (key: CriterionKey, value: Importance) => {
    setMessage(null);
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
      setSaved(preferences);
      setMessage('Saved on this device.');
    } catch {
      setMessage('Could not save your preferences. Try again.');
    }
  };

  const reset = () => {
    setMessage(null);
    setPreferences(DEFAULT_PREFERENCES);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">Preferences</ThemedText>
        <ThemedText themeColor="textSecondary">
          Choose how much each of these matters to you when comparing products.
        </ThemedText>

        {loading ? (
          <ActivityIndicator />
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {CRITERIA.map(({ key, label, hint }) => (
              <ThemedView key={key} type="backgroundElement" style={styles.card}>
                <ThemedView type="backgroundElement" style={styles.cardText}>
                  <ThemedText type="smallBold">{label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {hint}
                  </ThemedText>
                </ThemedView>

                <ThemedView type="backgroundElement" style={styles.options}>
                  {IMPORTANCE_LEVELS.map(({ value, label: levelLabel }) => {
                    const selected = preferences[key] === value;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => choose(key, value)}
                        accessibilityRole="radio"
                        accessibilityLabel={`${label}: ${levelLabel}`}
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.option,
                          { backgroundColor: selected ? ACCENT : theme.backgroundSelected },
                          pressed && styles.pressed,
                        ]}>
                        <ThemedText
                          type="small"
                          style={{ color: selected ? '#ffffff' : theme.text }}>
                          {levelLabel}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ThemedView>
              </ThemedView>
            ))}

            <ThemedView style={styles.actions}>
              <Pressable
                onPress={save}
                disabled={!hasChanges}
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: ACCENT },
                  !hasChanges && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                  Save preferences
                </ThemedText>
              </Pressable>

              <Pressable onPress={reset} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="linkPrimary">Reset to defaults</ThemedText>
              </Pressable>

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
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  cardText: {
    gap: Spacing.half,
  },
  options: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
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