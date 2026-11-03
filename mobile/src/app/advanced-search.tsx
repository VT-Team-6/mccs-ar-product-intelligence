import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RankPicker } from '@/components/rank-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { rankedCount } from '@/preferences/criteria';
import {
  EXAMPLE_REQUESTS,
  MAX_REQUEST_LENGTH,
  rankingFromParam,
  rankingToParam,
} from '@/search/advanced';

// The blue used for links elsewhere in the app
const ACCENT = '#3c87f7';

// Advanced search: the shopper describes what they need in their own words,
// like "waterproof hiking boots under $150", and can rank what matters most.
export default function AdvancedSearchScreen() {
  const router = useRouter();
  const theme = useTheme();
  // Coming back from the results with "Edit search" keeps what was typed and ranked
  const params = useLocalSearchParams<{ q?: string; rank?: string }>();
  const [text, setText] = useState(params.q ?? '');
  const [ranking, setRanking] = useState(() => rankingFromParam(params.rank));

  const request = text.trim();
  const ready = request.length > 0;

  const search = () => {
    if (!ready) return;
    const query = `q=${encodeURIComponent(request)}&rank=${encodeURIComponent(rankingToParam(ranking))}`;
    router.push(`/advanced-results?${query}` as Href);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/search' as Href))}
            hitSlop={12}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary">‹ Back</ThemedText>
          </Pressable>

          <View style={styles.section}>
            <ThemedText type="subtitle">Advanced search</ThemedText>
            <ThemedText themeColor="textSecondary">
              Describe what you need and we will find the best matches.
            </ThemedText>
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.questionTitle}>What are you looking for?</ThemedText>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="e.g. waterproof hiking boots under $150"
              placeholderTextColor={theme.textSecondary}
              multiline
              maxLength={MAX_REQUEST_LENGTH}
              accessibilityLabel="What are you looking for?"
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
              {`${text.length} / ${MAX_REQUEST_LENGTH}`}
            </ThemedText>

            <ThemedText type="small" themeColor="textSecondary">
              Try one of these:
            </ThemedText>
            <View style={styles.examples}>
              {EXAMPLE_REQUESTS.map((example) => (
                <Pressable
                  key={example}
                  onPress={() => setText(example)}
                  accessibilityRole="button"
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundElement" style={styles.example}>
                    <ThemedText type="small">{example}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.questionTitle}>What matters most? (optional)</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tap in order. Anything you don’t pick counts equally.
            </ThemedText>
          </View>
          <RankPicker value={ranking} onChange={setRanking} compact />

          <Pressable
            onPress={search}
            disabled={!ready}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: ACCENT },
              !ready && styles.disabled,
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" style={styles.buttonText}>
              Search
            </ThemedText>
          </Pressable>
          {!ready && (
            <ThemedText type="small" themeColor="textSecondary">
              {rankedCount(ranking) > 0
                ? 'Add a few words about what you need to search.'
                : 'Describe what you need to search.'}
            </ThemedText>
          )}
        </ScrollView>
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
    maxWidth: MaxContentWidth,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  section: {
    gap: Spacing.two,
  },
  questionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 700,
  },
  input: {
    fontSize: 16,
    minHeight: 96,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    textAlignVertical: 'top',
  },
  counter: {
    alignSelf: 'flex-end',
  },
  examples: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  example: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
  },
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  buttonText: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});