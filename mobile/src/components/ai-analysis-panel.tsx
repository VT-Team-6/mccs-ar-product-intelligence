import { useEffect, useId, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { getProductAnalysis, type ProductAnalysis } from '@/api/analysis';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import Svg, { Defs, ClipPath, Rect, Path } from 'react-native-svg';

type Props = {
  productId: number;
};

function PartialStar({ fill }: { fill: number }) {
  const clipId = useId();
  const percentage = Math.max(0, Math.min(1, fill));

  const path =
    'M12 2.2 15.1 8.4 22 9.4 17 14.3 18.2 21.2 12 18 5.8 21.2 7 14.3 2 9.4 8.9 8.4Z';

  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Defs>
        <ClipPath id={clipId}>
          <Rect
            x="0"
            y="0"
            width={percentage * 24}
            height={24}
          />
        </ClipPath>
      </Defs>

      <Path d={path} fill="#E5E5E5" />

      <Path
        d={path}
        fill="#D9A441"
        clipPath={`url(#${clipId})`}
      />
    </Svg>
  );
}

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

  const totalReviews = analysis?.total_review_count ?? analysis?.review_count ?? 0;
  const analyzedReviews = analysis?.review_count ?? 0;
  const distribution = analysis?.rating_distribution ?? {};

  const ratedReviews = Object.values(distribution).reduce(
    (total, count) => total + count,
    0
  );

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="subtitle">AI Product Analysis</ThemedText>
      </View>

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
      ) : !analysis || !totalReviews ? (
        <ThemedText themeColor="textSecondary">
          No customer reviews are available for analysis.
        </ThemedText>
      ) : (
        <View style={styles.content}>

          {/* Rating Overview */}
          <View style={styles.section}>
            <View style={styles.ratingHeader}>
              <ThemedText style={styles.averageRating}>
                {analysis.average_rating?.toFixed(1) ?? 'N/A'}
              </ThemedText>

              <View style={styles.ratingInfo}>
                <View style={{ flexDirection: 'row', gap: 3 }}>
                  {[0, 1, 2, 3, 4].map((index) => (
                    <PartialStar
                      key={index}
                      fill={(analysis.average_rating ?? 0) - index}
                    />
                  ))}
              </View>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                >
                  Based on {totalReviews} customer reviews
                </ThemedText>
              </View>
            </View>

            {/* Rating Distribution */}
            {[5, 4, 3, 2, 1].map((star) => {
              const count = distribution[String(star)] ?? 0;
              const percentage = ratedReviews > 0
                ? Math.round((count / ratedReviews) * 100)
                : 0;

              return (
                <View key={star} style={styles.ratingRow}>
                  <ThemedText style={styles.starNumber}>
                    {star}
                  </ThemedText>
                  <ThemedText style={styles.smallStar}>
                    ★
                  </ThemedText>

                  <View style={styles.barBackground}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${percentage}%` },
                      ]}
                    />
                  </View>

                  <ThemedText style={styles.percentage}>
                    {percentage}%
                  </ThemedText>
                </View>
              );
            })}

            <ThemedText
              type="small"
              themeColor="textSecondary"
            >
              {analyzedReviews} reviews analyzed
            </ThemedText>
          </View>

          <View style={styles.divider} />

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

          <View style={styles.divider} />

          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <ThemedText style={styles.footerIcon}>▤</ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.footerText}
              >
                These insights are based on available customer
                reviews{analysis.sources.length > 0
                  ? ` from ${analysis.sources.join(', ')}`
                  : ''}.
              </ThemedText>
            </View>

            <View style={styles.footerRow}>
              <ThemedText style={styles.footerIcon}>ⓘ</ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.footerText}
              >
                AI-generated analysis. Summaries may contain
                inaccuracies. Refer to original reviews for details.
              </ThemedText>
            </View>
          </View>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
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
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  averageRating: {
    fontSize: 35,
    fontWeight: '700',
  },
  ratingInfo: {
    gap: 3,
    flex: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  starNumber: {
    width: 12,
    fontSize: 12,
  },
  smallStar: {
    fontSize: 12,
    color: '#999999',
  },
  barBackground: {
    flex: 1,
    height: 8,
    backgroundColor: '#E5E5E5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#D9A441',
    borderRadius: 8,
  },
  percentage: {
    width: 38,
    textAlign: 'right',
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: '#D9D9D9',
    marginVertical: Spacing.one,
  },
  prosCard: {
    backgroundColor: '#EDF7F0',
    borderColor: '#C8E5D0',
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  consCard: {
    backgroundColor: '#FBEFEE',
    borderColor: '#F0D2CE',
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.one,
  },
  proIcon: {
    fontSize: 17,
  },
  conIcon: {
    fontSize: 17,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  bulletText: {
    flex: 1,
    color: '#303030',
  },
  proCheck: {
    fontSize: 18,
    fontWeight: '700',
    color: '#27864D',
    width: 20,
  },
  conMinus: {
    fontSize: 20,
    fontWeight: '700',
    color: '#C34D45',
    width: 20,
  },
  footer: {
    gap: Spacing.three,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  footerIcon: {
    fontSize: 16,
    color: '#777777',
    width: 20,
  },
  footerText: {
    flex: 1,
    lineHeight: 18,
  },
});

