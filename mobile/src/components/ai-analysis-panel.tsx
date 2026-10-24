
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { getProductAnalysis, type ProductAnalysis } from '@/api/analysis';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type Props = {
  productId: number;
};

export function AIAnalysisPanel({ productId }: Props) {
  const [analysis, setAnalysis] = useState<ProductAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setAnalysis(null);

    getProductAnalysis(productId)
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .catch((problem: unknown) => {
        if (!cancelled) {
          setError(
            problem instanceof Error
              ? problem.message
              : 'Could not load AI analysis.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [productId, retryCount]);

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <ThemedText type="subtitle">AI Product Analysis</ThemedText>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <ThemedText themeColor="textSecondary">
            Analyzing customer reviews...
          </ThemedText>
        </View>
      ) : error ? (
        <View style={styles.section}>
          <ThemedText themeColor="textSecondary">
            {error}
          </ThemedText>
          <Pressable
            onPress={() => setRetryCount((count) => count + 1)}
            accessibilityRole="button"
          >
            <ThemedText type="linkPrimary">Try again</ThemedText>
          </Pressable>
        </View>
      ) : !analysis || !analysis.review_count ? (
        <ThemedText themeColor="textSecondary">
          No customer reviews are available for analysis.
        </ThemedText>
      ) : (
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            AI-generated insights based on {analysis.review_count} customer reviews
          </ThemedText>

          <View style={styles.section}>
            <ThemedText type="smallBold">Overall Summary</ThemedText>
            <ThemedText>
              {analysis.summary || 'Not enough information to generate a summary.'}
            </ThemedText>
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">Pros</ThemedText>
            {analysis.pros.length > 0 ? (
              analysis.pros.map((pro, index) => (
                <ThemedText key={`pro-${index}`}>
                  {'✓  '}{pro}
                </ThemedText>
              ))
            ) : (
              <ThemedText themeColor="textSecondary">
                No clear positive themes identified.
              </ThemedText>
            )}
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">Cons</ThemedText>
            {analysis.cons.length > 0 ? (
              analysis.cons.map((con, index) => (
                <ThemedText key={`con-${index}`}>
                  {'•  '}{con}
                </ThemedText>
              ))
            ) : (
              <ThemedText themeColor="textSecondary">
                No clear negative themes identified.
              </ThemedText>
            )}
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            AI-generated summaries may contain errors. Based on available reviews.
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
    gap: Spacing.two,
  },
  section: {
    gap: Spacing.two,
  },
});

