import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Product } from '@/api/products';
import { getRecommendations, type Recommendation, type RecommendationResult } from '@/api/recommendations';
import { ProductCard } from '@/components/product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { CRITERIA } from '@/preferences/criteria';
import { describeUnderstood, rankingFromParam } from '@/search/advanced';
import { useStore } from '@/store/StoreContext';

// The blue used for links elsewhere in the app
const ACCENT = '#3c87f7';

// Results for an advanced search, e.g. /advanced-results?q=waterproof%20boots&rank=price
export default function AdvancedResultsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; rank?: string }>();
  const query = (params.q ?? '').trim();
  const rankParam = params.rank ?? '';
  const ranking = useMemo(() => rankingFromParam(rankParam), [rankParam]);
  // Reprice the cards when the shopper switches stores.
  const { store } = useStore();

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
    router.push(`/product/${product.product_id}?from=${encodeURIComponent(thisPage)}` as Href);
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
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <Pressable onPress={editSearch} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="linkPrimary">‹ Edit search</ThemedText>
            </Pressable>
          </View>

          <View style={styles.section}>
            <ThemedText type="subtitle">Best matches</ThemedText>
            {query !== '' && (
              <ThemedText themeColor="textSecondary">{`For "${query}"`}</ThemedText>
            )}
            {understood.length > 0 && (
              <View style={styles.chips}>
                <ThemedText type="small" themeColor="textSecondary">
                  Looking for:
                </ThemedText>
                {understood.map((label) => (
                  <ThemedView key={label} type="backgroundElement" style={styles.chip}>
                    <ThemedText type="small">{label}</ThemedText>
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
                <ResultCard
                  key={item.product.product_id}
                  item={item}
                  label={`#${index + 1}`}
                  onOpen={openProduct}
                />
              ))}

              {result.for_you && (
                <View style={styles.forYou}>
                  <ThemedText type="subtitle">Recommended for You</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Also based on your saved preferences and likes
                  </ThemedText>
                  <ResultCard item={result.for_you} onOpen={openProduct} highlight />
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

// A product card with its rank and the reasons it was picked
function ResultCard({
  item,
  label,
  onOpen,
  highlight = false,
}: {
  item: Recommendation;
  label?: string;
  onOpen: (product: Product) => void;
  highlight?: boolean;
}) {
  return (
    <ProductCard
      product={item.product}
      onPress={() => onOpen(item.product)}
      event={label}
      meta={item.reasons.length > 0 ? item.reasons.join(' · ') : null}
      style={highlight ? styles.highlight : undefined}
    />
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
  headerRow: {
    flexDirection: 'row',
  },
  section: {
    gap: Spacing.one,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.one,
  },
  chip: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.three,
  },
  forYou: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  highlight: {
    borderWidth: 2,
    borderColor: ACCENT,
  },
  pressed: {
    opacity: 0.6,
  },
});