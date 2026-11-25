import { useAuth } from '@/auth/AuthContext';
import { SignInRequired } from '@/components/authentication/SignInRequired';

import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { likeProduct, listProductHistory, unlikeProduct, type HistoryItem } from '@/api/me';
import { ProductCard } from '@/components/product-card';
import { MAX_COMPARE, compareHref, selectionProblem } from '@/compare/selection';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SectionLabel } from '@/components/ui/section-label';
import { BottomTabInset, Brand, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/store/StoreContext';

const PAGE_SIZE = 20;

// A navy left edge on cards picked for comparing. Passed as a plain object
// rather than a StyleSheet style, because on web the card's own border color
// would otherwise win over it.
const SELECTED_EDGE = { borderLeftWidth: 5, borderLeftColor: Brand.navy };

// How each recorded interaction reads in the feed.
const EVENT_LABELS: Record<string, string> = {
  scanned: 'Scanned',
  viewed: 'Viewed',
  'viewed-from-search': 'Viewed from search',
  'viewed-from-recommendation': 'Viewed from recommendations',
  liked: 'Liked',
  unliked: 'Unliked',
};


type HistorySection = {
  title: string;
  data: HistoryItem[];
};

// What one loaded page of History looks like, tagged with the request it answers
// so a slow response can never overwrite a newer search.
type LoadedHistory = {
  key: string;
  items: HistoryItem[];
  nextCursor: string | null;
  error: string | null;
};

// History is an activity feed: the same product can appear many times, each
// entry saying how the user got to it and when.
export default function HistoryScreen() {
  const { user } = useAuth();
  return user ? <HistoryContent /> : <SignInRequired message="Sign in to see your history." />;
}

function HistoryContent() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { store } = useStore();

  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim());
  const [reloadKey, setReloadKey] = useState(0);

  const requestKey = `${query}\u0000${reloadKey}\u0000${store?.store_id ?? ''}`;
  const [page, setPage] = useState<LoadedHistory | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Track products selected for comparison
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);

  const items = page?.items ?? [];
  const nextCursor = page?.nextCursor ?? null;
  const error = page?.key === requestKey ? page?.error ?? null : null;
  const loading = page?.key !== requestKey;

  // Reloads when the tab comes back into view, so newly recorded events appear
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setReloadKey((key) => key + 1);
    }, []),
  );

  useEffect(() => {
    let cancelled = false;
    listProductHistory({ query, limit: PAGE_SIZE, storeId: store?.store_id })
      .then((loaded) => {
        if (cancelled) return;
        setPage({
          key: requestKey,
          items: loaded.items,
          nextCursor: loaded.next_cursor,
          error: null,
        });
      })
      .catch((problem: unknown) => {
        if (cancelled) return;
        setPage({ key: requestKey, items: [], nextCursor: null, error: errorMessage(problem) });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, query, store?.store_id]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await listProductHistory({ query, limit: PAGE_SIZE, cursor: nextCursor, storeId: store?.store_id });
      setPage((current) =>
        current && current.key === requestKey
          ? {
              ...current,
              items: [...current.items, ...more.items],
              nextCursor: more.next_cursor,
            }
          : current,
      );
    } catch (problem) {
      setPage((current) =>
        current
          ? { ...current, error: errorMessage(problem) }
          : { key: requestKey, items: [], nextCursor: null, error: errorMessage(problem) },
      );
    } finally {
      setLoadingMore(false);
    }
  };

  // Only products in the same category can be compared (not coffee with shoes)
  const pickedCategories = new Set(
    items
      .filter((item) => selectedIds.includes(item.product.product_id) && item.product.category)
      .map((item) => item.product.category),
  );
  const mixedCategories = pickedCategories.size > 1;

  // Select or deselect a product
  const toggleCompare = (productId: number) => {
    if (selectedIds.includes(productId)) {
      setSelectedIds((current) =>
        current.filter((id) => id !== productId),
      );
      setSelectionMessage(null);
    } else if (selectedIds.length >= MAX_COMPARE) {
      setSelectionMessage(
        `You can compare up to ${MAX_COMPARE} products at a time.`,
      );
    } else {
      setSelectedIds((current) => [...current, productId]);
      setSelectionMessage(null);
    }
  };

  // Determine whether comparison is allowed
  const compareProblem = mixedCategories
    ? 'These products are not in the same category, so they can’t be compared.'
    : selectionProblem(selectedIds.length);

  // The heart shows the product's current state, not its state at event time,
  // so changing it updates every row for that product.
  const toggleLike = async (item: HistoryItem) => {
    const productId = item.product.product_id;
    const wasLiked = item.product.is_liked;
    setPage((current) =>
      current
        ? { ...current, items: setProductLiked(current.items, productId, !wasLiked) }
        : current,
    );
    try {
      if (wasLiked) {
        await unlikeProduct(productId, store?.store_id);
      } else {
        await likeProduct(productId, store?.store_id);
      }
    } catch (problem) {
      setPage((current) =>
        current
          ? {
              ...current,
              items: setProductLiked(current.items, productId, wasLiked),
              error: errorMessage(problem),
            }
          : current,
      );
    }
  };
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Search your product history"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[
            styles.search,
            { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
          ]}
        />

        {/* Shown under the search bar, only while loading, so no empty line sits above it */}
        {loading && items.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            Loading your activity
          </ThemedText>
        )}

        {/* Navy strip, like the Home header, so comparing stands out */}
        <View style={styles.compareToolbar}>
          <View style={styles.compareToolbarRow}>
            <View style={styles.compareToolbarText}>
              <ThemedText type="smallBold" style={styles.onNavy}>
                Compare products
              </ThemedText>

              <ThemedText type="small" style={styles.onNavyMuted}>
                {selectedIds.length} of {MAX_COMPARE} selected · Choose at least 2
              </ThemedText>
            </View>

            {selectedIds.length > 0 && (
              <Pressable
                onPress={() => {
                  setSelectedIds([]);
                  setSelectionMessage(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear comparison selection"
              >
                <ThemedText type="linkPrimary" style={styles.onNavyLink}>
                  Clear
                </ThemedText>
              </Pressable>
            )}

            <Pressable
              disabled={compareProblem !== null}
              accessibilityRole="button"
              accessibilityState={{
                disabled: compareProblem !== null,
              }}
              onPress={() =>
                router.push(compareHref(selectedIds) as Href)
              }
              style={[
                styles.compareButton,
                compareProblem !== null &&
                  styles.compareButtonDisabled,
              ]}
            >
              <ThemedText style={styles.compareButtonText}>
                Compare
              </ThemedText>
            </Pressable>
          </View>

          {/* Mixed categories (e.g. coffee and shoes) can't be compared */}
          {mixedCategories && (
            <ThemedText type="small" style={styles.onNavyWarning}>
              {compareProblem}
            </ThemedText>
          )}
        </View>

        {selectionMessage && (
          <ThemedText type="small" themeColor="textSecondary">
            {selectionMessage}
          </ThemedText>
        )}

        {error && (
          <ThemedView style={styles.message}>
            <ThemedText themeColor="textSecondary">{error}</ThemedText>
            <Pressable
              onPress={() => setReloadKey((key) => key + 1)}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="linkPrimary">Try again</ThemedText>
            </Pressable>
          </ThemedView>
        )}

        {loading && items.length === 0 && <ActivityIndicator />}

        <SectionList
          sections={groupByDay(items)}
          keyExtractor={(item) => String(item.history_id)}
          stickySectionHeadersEnabled={false}
          // Full width, so the scroll bar sits at the screen's edge
          style={styles.edgeToEdge}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <SectionLabel label={section.title} style={styles.sectionTitle} />
          )}
          
          renderItem={({ item }) => {
            const productId = item.product.product_id;
            const selected = selectedIds.includes(productId);

            return (
              <View style={styles.historyEntry}>
                <Pressable
                  onPress={() => toggleCompare(productId)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${
                    selected ? 'Deselect' : 'Select'
                  } ${item.product.name} for comparison`}
                  style={styles.selectionButton}
                >
                  <View
                    style={[
                      styles.checkbox,
                      selected && styles.checkboxSelected,
                    ]}
                  >
                    {selected && (
                      <ThemedText style={styles.checkmark}>✓</ThemedText>
                    )}
                  </View>
                </Pressable>

                <View style={styles.productCardWrapper}>
                  <ProductCard
                    product={item.product}
                    isLiked={item.product.is_liked}
                    onToggleLike={() => toggleLike(item)}
                    showDetails={false}
                    // A navy edge marks the products picked for comparing
                    style={selected ? SELECTED_EDGE : undefined}
                    event={`${EVENT_LABELS[item.interaction] ?? item.interaction} · ${formatTime(
                      item.occurred_at,
                    )}`}
                    // No store or past-price line: it made rows very tall, and a
                    // product can be viewed from home, not only at a store
                    onPress={() =>
                      router.push({
                        pathname: '/product/[id]',
                        params: {
                          id: String(productId),
                          from: '/products/history',
                        },
                      })
                    }
                  />
                </View>
              </View>
            );
          }}

          ListEmptyComponent={
            !loading && !error ? (
              <EmptyHistory
                query={query}
                onClear={() => setText('')}
                onBrowse={() => router.push('/search')}
              />
            ) : null
          }
          ListFooterComponent={
            nextCursor ? (
              <Pressable
                onPress={loadMore}
                disabled={loadingMore}
                accessibilityRole="button"
                style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}>
                <ThemedView type="backgroundElement" style={styles.loadMoreButton}>
                  <ThemedText type="smallBold">
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            ) : null
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function EmptyHistory({
  query,
  onClear,
  onBrowse,
}: {
  query: string;
  onClear: () => void;
  onBrowse: () => void;
}) {
  if (query) {
    return (
      <ThemedView style={styles.message}>
        <ThemedText themeColor="textSecondary">{`No history matches "${query}".`}</ThemedText>
        <Pressable onPress={onClear} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="linkPrimary">Clear search</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.message}>
      <ThemedText type="smallBold">No product activity yet</ThemedText>
      <ThemedText themeColor="textSecondary">Scan a product to see activity here.</ThemedText>
      <Pressable onPress={onBrowse} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedText type="linkPrimary">Browse products</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

// Updates the current like state of every row for one product
function setProductLiked(
  items: HistoryItem[],
  productId: number,
  isLiked: boolean,
): HistoryItem[] {
  return items.map((item) =>
    item.product.product_id === productId
      ? { ...item, product: { ...item.product, is_liked: isLiked } }
      : item,
  );
}

// "Today", "Yesterday", then a readable date, keeping newest-first order
function groupByDay(items: HistoryItem[]): HistorySection[] {
  const sections: HistorySection[] = [];
  for (const item of items) {
    const title = dayTitle(item.occurred_at);
    const last = sections[sections.length - 1];
    if (last && last.title === title) {
      last.data.push(item);
    } else {
      sections.push({ title, data: [item] });
    }
  }
  return sections;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayTitle(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = startOfDay(new Date());
  const day = startOfDay(date);
  if (day === today) return 'Today';
  if (day === today - 24 * 60 * 60 * 1000) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// The user's own clock; the backend stores UTC
function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function errorMessage(problem: unknown): string {
  if (problem instanceof TypeError) {
    return 'Could not reach the backend. Is it running?';
  }
  if (problem instanceof Error) {
    return problem.message;
  }
  return 'Could not load your history.';
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
    // The segment control above this stack already handles the top inset
    paddingTop: Spacing.two,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  search: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  message: {
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  edgeToEdge: {
    marginHorizontal: -Spacing.four,
  },
  list: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  sectionTitle: {
    paddingTop: Spacing.two,
  },
  compareToolbar: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    borderRadius: Radius.medium,
    backgroundColor: Brand.navy,
  },
  onNavy: {
    color: '#ffffff',
  },
  onNavyMuted: {
    color: 'rgba(255,255,255,0.7)',
  },
  // A light red that reads well on navy in both modes
  onNavyWarning: {
    color: '#FF8A8A',
  },
  compareToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  onNavyLink: {
    color: '#C9D6EC',
  },
  compareToolbarText: {
    flex: 1,
    gap: Spacing.half,
  },
  compareButton: {
    backgroundColor: Brand.red,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.small,
  },
  compareButtonDisabled: {
    opacity: 0.4,
  },
  compareButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  historyEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  selectionButton: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.one,
  },
  productCardWrapper: {
    flex: 1,
    minWidth: 0,
  },
  checkbox: {
    height: 20,
    width: 20,
    borderWidth: 1.5,
    borderColor: '#777777',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    borderColor: Brand.navy,
    backgroundColor: Brand.navy,
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  loadMore: {
    paddingVertical: Spacing.two,
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});