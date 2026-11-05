import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getComparison, type CompareItem, type ComparisonData } from '@/api/compare';
import { productImageUrl, storePriceLine, storePriceValue } from '@/api/products';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { compareHref, readSelection, selectionProblem } from '@/compare/selection';
import { useStore } from '@/store/StoreContext';

// The blue used for links elsewhere in the app
const ACCENT = '#3c87f7';
// Each product gets a column this wide. More than fit on screen scroll sideways.
const COLUMN_WIDTH = 168;

// Side-by-side comparison, e.g. /compare?ids=3,7
export default function CompareScreen() {
  const router = useRouter();
  const { ids: idsParam } = useLocalSearchParams<{ ids?: string }>();
  const selection = useMemo(() => readSelection(idsParam), [idsParam]);
  const { store } = useStore();

  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Goes up by one each time "Try again" is pressed, which loads again
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Don't load anything for a selection that can't be compared
    if (selection.problem) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getComparison(selection.ids)
      .then((found) => {
        if (!cancelled) setData(found);
      })
      .catch((problem: unknown) => {
        if (!cancelled) {
          setData(null);
          setError(
            problem instanceof TypeError
              ? 'Could not reach the backend. Is it running?'
              : 'Could not load the comparison. Try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selection, attempt, store?.store_id]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/' as Href));

  // Some products may have been deleted. Check the size again with what's left.
  const items = data?.items ?? [];
  const problem = selection.problem ?? (data ? selectionProblem(items.length) : null);

  const openProduct = (item: CompareItem) => {
    const here = compareHref(selection.ids);
    router.push(`/product/${item.product.product_id}?from=${encodeURIComponent(here)}` as Href);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <Pressable onPress={goBack} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="linkPrimary">‹ Back</ThemedText>
            </Pressable>
          </View>

          <ThemedText type="subtitle">Compare products</ThemedText>

          {loading ? (
            <ActivityIndicator />
          ) : error ? (
            <View style={styles.message}>
              <ThemedText themeColor="textSecondary">{error}</ThemedText>
              <Pressable
                onPress={() => setAttempt((count) => count + 1)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="linkPrimary">Try again</ThemedText>
              </Pressable>
            </View>
          ) : problem ? (
            <View style={styles.message}>
              <ThemedText>{problem}</ThemedText>
              {data && data.missing.length > 0 && <MissingNote count={data.missing.length} />}
              <ThemedText type="small" themeColor="textSecondary">
                Select products from your History to compare them.
              </ThemedText>
              <Pressable onPress={goBack} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="linkPrimary">Go back</ThemedText>
              </Pressable>
            </View>
          ) : data ? (
            <>
              {data.missing.length > 0 && <MissingNote count={data.missing.length} />}
              <ComparisonTable items={items} onOpen={openProduct} />
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function MissingNote({ count }: { count: number }) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {count === 1
        ? '1 product is no longer available and was left out.'
        : `${count} products are no longer available and were left out.`}
    </ThemedText>
  );
}

// One column per product and one row per detail, so the same detail lines up across products
function ComparisonTable({ items, onOpen }: { items: CompareItem[]; onOpen: (item: CompareItem) => void }) {
  const { store } = useStore();
  // Prices at the shopper's chosen store. storePriceValue already returns null
  // rather than NaN for a missing or non-finite price.
  const prices = items.map(({ product }) => {
    const price = storePriceValue(product);
    return price === null ? null : Math.round(price * 100) / 100;
  });
  const ratings = items.map(({ product }) =>
    product.rating === null ? null : Math.round(product.rating * 10) / 10,
  );
  
  const lowestPrice = bestIndexes(prices, 'lowest');
  const highestRating = bestIndexes(ratings, 'highest');

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.table}>
      <View style={styles.tableBody}>
        <Row>
          {items.map((item) => {
            const imageUrl = productImageUrl(item.product);
            return (
              <Pressable
                key={item.product.product_id}
                onPress={() => onOpen(item)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.image} contentFit="contain" />
                ) : (
                  <ThemedView type="backgroundSelected" style={styles.image} />
                )}
                <ThemedText type="smallBold" numberOfLines={3}>
                  {item.product.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </Row>

        <Row label="Price">
          {items.map((item, index) => {
            const line = storePriceLine(
              item.product,
              store?.store_id ?? null,
              store?.name ?? null,
            );
            return (
              <Cell
                key={item.product.product_id}
                value={line.price ?? line.label}
                badge={lowestPrice.has(index) ? 'Lowest price' : null}
              />
            );
          })}
        </Row>

        <Row label="Rating">
          {items.map((item, index) => (
            <Cell
              key={item.product.product_id}
              value={item.product.rating === null ? 'No rating' : `${item.product.rating.toFixed(1)} / 5`}
              badge={highestRating.has(index) ? 'Highest rated' : null}
            />
          ))}
        </Row>

        <Row label="Reviews">
          {items.map((item) => (
            <Cell
              key={item.product.product_id}
              value={item.review_count === null ? 'Not available' : String(item.review_count)}
            />
          ))}
        </Row>

        <Row label="Brand">
          {items.map((item) => (
            <Cell key={item.product.product_id} value={item.product.brand ?? 'Unknown'} />
          ))}
        </Row>

        <Row label="Type">
          {items.map((item) => (
            <Cell key={item.product.product_id} value={item.product.product_type} />
          ))}
        </Row>

        <Row label="About">
          {items.map((item) => (
            <Cell
              key={item.product.product_id}
              value={item.product.description ?? 'No description'}
              small
              lines={6}
            />
          ))}
        </Row>

        <Row>
          {items.map((item) => (
            <Pressable
              key={item.product.product_id}
              onPress={() => onOpen(item)}
              style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
              <ThemedText type="linkPrimary">View product ›</ThemedText>
            </Pressable>
          ))}
        </Row>
      </View>
    </ScrollView>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View style={styles.rowGroup}>
      {label && (
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
      )}
      <View style={styles.row}>{children}</View>
    </View>
  );
}

function Cell({
  value,
  badge = null,
  small = false,
  lines,
}: {
  value: string;
  badge?: string | null;
  small?: boolean;
  lines?: number;
}) {
  return (
    <ThemedView type="backgroundElement" style={[styles.cell, styles.valueCell]}>
      <ThemedText type={small ? 'small' : 'default'} numberOfLines={lines}>
        {value}
      </ThemedText>
      {badge && (
        <ThemedText type="smallBold" style={styles.badge}>
          {badge}
        </ThemedText>
      )}
    </ThemedView>
  );
}

// Which products have the best value. Ties all count. Only marked when at least
// two products have a value and they aren't all the same, so the badge means something.
// Non-finite values are dropped too: a NaN survives a null-only filter and would
// poison Math.min/Math.max, silently removing every badge.
function bestIndexes(values: (number | null)[], want: 'lowest' | 'highest'): Set<number> {
  const known = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (known.length < 2 || Math.min(...known) === Math.max(...known)) return new Set();
  const best = want === 'lowest' ? Math.min(...known) : Math.max(...known);
  return new Set(values.flatMap((value, index) => (value === best ? [index] : [])));
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
  message: {
    gap: Spacing.two,
  },
  table: {
    paddingBottom: Spacing.two,
  },
  tableBody: {
    gap: Spacing.three,
  },
  rowGroup: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  cell: {
    width: COLUMN_WIDTH,
    gap: Spacing.two,
  },
  valueCell: {
    padding: Spacing.two,
    borderRadius: Spacing.two,
    gap: Spacing.half,
  },
  image: {
    width: COLUMN_WIDTH,
    height: 110,
    borderRadius: Spacing.two,
    backgroundColor: '#ffffff',
  },
  badge: {
    color: ACCENT,
  },
  pressed: {
    opacity: 0.6,
  },
});