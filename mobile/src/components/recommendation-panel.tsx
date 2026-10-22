import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { Product } from '@/api/products';
import { getRecommendations, type Recommendation, type RecommendationResult } from '@/api/recommendations';
import { ProductCard } from '@/components/product-card';
import { RankPicker } from '@/components/rank-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_PREFERENCES, rankedCount, type Preferences } from '@/preferences/criteria';

// The blue used for links elsewhere in the app
const ACCENT = '#3c87f7';

type Props = {
  // The product on screen. Leave out for Advanced Search.
  productId?: number;
  // Advanced Search has no product, so the text is what it searches for
  textRequired?: boolean;
  onOpenProduct: (product: Product) => void;
  // Called when the questions or results appear, so the page can scroll to them
  onStepChange?: () => void;
};

// Asks the two questions, then shows Best Matches and Recommended for You.
// Used at the bottom of product details, and on its own for Advanced Search.
export function RecommendationPanel({ productId, textRequired = false, onOpenProduct, onStepChange }: Props) {
  const theme = useTheme();
  const [ranking, setRanking] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecommendationResult | null>(null);

  const ready = rankedCount(ranking) > 0 && (!textRequired || text.trim() !== '');

  const recommend = async () => {
    if (!ready || loading) return;
    setLoading(true);
    setError(null);
    try {
      const trimmed = text.trim();
      setResult(
        await getRecommendations({
          product_id: productId,
          text: trimmed === '' ? undefined : trimmed,
          ranking,
        }),
      );
      onStepChange?.();
    } catch (problem) {
      setError(
        problem instanceof TypeError
          ? 'Could not reach the backend. Is it running?'
          : problem instanceof Error
            ? problem.message
            : 'Could not get recommendations.',
      );
    } finally {
      setLoading(false);
    }
  };

  // Results: the answers stay saved, so "Change answers" brings them back as they were
  if (result) {
    return (
      <View style={styles.panel}>
        <ThemedView style={styles.headerRow}>
          <ThemedText type="subtitle">Best Matches</ThemedText>
          <Pressable
            onPress={() => {
              setResult(null);
              onStepChange?.();
            }}
            hitSlop={12}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary">Change answers</ThemedText>
          </Pressable>
        </ThemedView>

        {result.best_matches.length === 0 ? (
          <ThemedText themeColor="textSecondary">No matches found. Try different answers.</ThemedText>
        ) : (
          result.best_matches.map((item, index) => (
            <ResultCard key={item.product.product_id} item={item} label={`#${index + 1}`} onOpen={onOpenProduct} />
          ))
        )}

        {result.for_you && (
          <View style={styles.forYou}>
            <ThemedText type="subtitle">Recommended for You</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Also based on your saved preferences and likes
            </ThemedText>
            <ResultCard item={result.for_you} onOpen={onOpenProduct} highlight />
          </View>
        )}
      </View>
    );
  }

  // Questions
  return (
    <View style={styles.panel}>
      <ThemedView style={styles.question}>
        <ThemedText type="subtitle">What matters most right now?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Tap in order. Pick at least one; the rest count equally.
        </ThemedText>
      </ThemedView>
      <RankPicker value={ranking} onChange={setRanking} />

      <ThemedView style={styles.question}>
        <ThemedText type="subtitle">What are you looking for?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {textRequired ? 'Describe what you need.' : 'Optional, like "for a wedding" or "something waterproof".'}
        </ThemedText>
      </ThemedView>
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={recommend}
        placeholder={textRequired ? 'e.g. warm boots for snow' : 'Optional'}
        placeholderTextColor={theme.textSecondary}
        returnKeyType="search"
        maxLength={200}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />

      {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}

      <Pressable
        onPress={recommend}
        disabled={!ready || loading}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: ACCENT },
          (!ready || loading) && styles.disabled,
          pressed && styles.pressed,
        ]}>
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <ThemedText type="smallBold" style={styles.buttonText}>
            Recommend
          </ThemedText>
        )}
      </Pressable>
    </View>
  );
}

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
      meta={item.reasons.join(' · ')}
      style={highlight ? styles.highlight : undefined}
    />
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.three,
  },
  question: {
    gap: Spacing.half,
    paddingTop: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  buttonText: {
    color: '#ffffff',
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
  disabled: {
    opacity: 0.4,
  },
});