import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { RankPicker } from '@/components/rank-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SectionLabel } from '@/components/ui/section-label';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { rankedCount } from '@/preferences/criteria';
import {
  EXAMPLE_REQUESTS,
  MAX_REQUEST_LENGTH,
  rankingFromParam,
  rankingToParam,
} from '@/search/advanced';


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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title="Advanced search"
          eyebrow="Find the best match"
          subtitle="Describe what you need and we will find the best matches."
          fallback="/search"
        />

        <View style={styles.content}>
          <View style={styles.section}>
            <SectionLabel label="Step 1" />
            <ThemedText style={styles.questionTitle}>What are you looking for?</ThemedText>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="e.g. waterproof hiking boots under $175"
              placeholderTextColor={theme.textSecondary}
              multiline
              maxLength={MAX_REQUEST_LENGTH}
              accessibilityLabel="What are you looking for?"
              style={[
                styles.input,
                { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
              ]}
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
                  <ThemedView type="card" style={[styles.example, { borderColor: theme.link }]}>
                    <ThemedText type="small" themeColor="link">
                      {example}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <SectionLabel label="Step 2 (optional)" />
            <ThemedText style={styles.questionTitle}>What matters most?</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tap in order. Anything you don’t pick counts equally.
            </ThemedText>
          </View>
          <RankPicker value={ranking} onChange={setRanking} compact />

          <AppButton label="Search" onPress={search} disabled={!ready} />
          {!ready && (
            <ThemedText type="small" themeColor="textSecondary">
              {rankedCount(ranking) > 0
                ? 'Add a few words about what you need to search.'
                : 'Describe what you need to search.'}
            </ThemedText>
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    paddingBottom: BottomTabInset + Spacing.four,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
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
    borderRadius: Radius.medium,
    borderWidth: 1,
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
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});