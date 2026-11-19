import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Product } from '@/api/products';
import { getRecommendations, type RecommendationResult } from '@/api/recommendations';
import { MatchCard } from '@/components/match-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SectionLabel } from '@/components/ui/section-label';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CRITERIA } from '@/preferences/criteria';
import { describeUnderstood, rankingFromParam } from '@/search/advanced';
import { useStore } from '@/store/StoreContext';

// Results for an advanced search, e.g. /advanced-results?q=waterproof%20boots&rank=price
export default function AdvancedResultsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; rank?: string }>();
  const query = (params.q ?? '').trim();
  const rankParam = params.rank ?? '';
  const ranking = useMemo(() => rankingFromParam(rankParam), [rankParam]);
  // Reprice the cards when the shopper switches stores.
  const { store } = useStore();
  const theme = useTheme();

  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Goes up by one each time "Try again" is pressed, which runs the search again
  const [attempt, setAttempt] = useState(0);

  // How the backend read the text, e.g. ["Under $150", "Waterproof"]
  const understood = describeUnderstood(result?.understood);
  const hasLimits = understood.length > 0;

  // The shopper's priorities in order, e.g. ["Comfort", "Price"]
  const priorities = CRITERIA.filter(({ key }) => ranking[key] > 0)
    .sort((a, b) => ranking[a.key] - ranking[b.key])
    .map(({ label }) => label);

  useEffect(() => {
    if (!query) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRecommendations({ text: query, ranking })
      .then((found) => {
        if (!cancelled) setResult(found);
      })
      .catch((problem: unknown) => {
        if (!cancelled) {
          setResult(null);
          setError(
            problem instanceof TypeError
              ? 'Could not reach the backend. Is it running?'
              : 'Could not get results. Try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, ranking, attempt, store?.store_id]);

  const thisPage = `/advanced-results?q=${encodeURIComponent(query)}&rank=${encodeURIComponent(rankParam)}`;

  // Opens product details. "from" brings Back to these results.
  const openProduct = (product: Product) => {
    router.push(
      `/product/${product.product_id}?from=${encodeURIComponent(thisPage)}&via=recommendation` as Href,
    );
  };

  // Back to the form with the same words and ranking filled in. The form is
  // usually right underneath, so going back avoids stacking a new copy each time.
  const editSearch = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(
        `/advanced-search?q=${encodeURIComponent(query)}&rank=${encodeURIComponent(rankParam)}` as Href,
      );
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenHeader
          title="Best matches"
          eyebrow="Advanced search"
          subtitle={query !== '' ? `For "${query}"` : undefined}
          // Back to the form with the same words and ranking filled in
          backLabel="Edit search"
          from={`/advanced-search?q=${encodeURIComponent(query)}&rank=${encodeURIComponent(rankParam)}`}
        />

        <View style={styles.content}>
          <View style={styles.section}>
            {understood.length > 0 && (
              <View style={styles.chips}>
                <SectionLabel label="Looking for" style={styles.chipsLabel} />
                {understood.map((label) => (
                  <ThemedView
                    key={label}
                    type="card"
                    style={[styles.chip, { borderColor: theme.link }]}>
                    <ThemedText type="small" themeColor="link">
                      {label}
                    </ThemedText>
                  </ThemedView>
                ))}
              </View>
            )}
            {priorities.length > 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {`Your priorities: ${priorities.map((label, i) => `${i + 1}. ${label}`).join('  ')}`}
              </ThemedText>
            )}
          </View>

          {query === '' ? (
            <ThemedText themeColor="textSecondary">Describe what you need to see results.</ThemedText>
          ) : loading ? (
            <ActivityIndicator />
          ) : error ? (
            <View style={styles.section}>
              <ThemedText themeColor="textSecondary">{error}</ThemedText>
              <Pressable
                onPress={() => setAttempt((count) => count + 1)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="linkPrimary">Try again</ThemedText>
              </Pressable>
            </View>
          ) : result && result.best_matches.length === 0 ? (
            <View style={styles.section}>
              <ThemedText themeColor="textSecondary">
                {hasLimits
                  ? 'No products match all of that. Try a higher budget or fewer requirements.'
                  : 'No good matches. Try describing it differently, like "boots for snow".'}
              </ThemedText>
              <Pressable onPress={editSearch} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="linkPrimary">Edit search</ThemedText>
              </Pressable>
            </View>
          ) : result ? (
            <>
              {result.best_matches.map((item, index) => (
                <MatchCard
                  key={item.product.product_id}
                  item={item}
                  rank={index + 1}
                  onOpen={openProduct}
                />
              ))}

              {result.for_you && (
                <View style={styles.forYou}>
                  <SectionLabel label="Recommended for you" />
                  <ThemedText type="small" themeColor="textSecondary">
                    Also based on your saved preferences and likes
                  </ThemedText>
                  <MatchCard item={result.for_you} onOpen={openProduct} highlight />
                </View>
              )}
            </>
          ) : null}
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
  },
  chipsLabel: {
    marginRight: Spacing.one,
  },
  chip: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  forYou: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});