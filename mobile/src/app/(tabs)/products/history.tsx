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
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/store/StoreContext';

const PAGE_SIZE = 20;

// How each recorded interaction reads in the feed.
const EVENT_LABELS: Record<string, string> = {
  scanned: 'Scanned',
  viewed: 'Viewed',
  'viewed-from-search': 'Viewed from search',
  'viewed-from-recommendation': 'Viewed from recommendations',
  liked: 'Liked',
  unliked: 'Unliked',
};

// Interactions that mean the shopper was looking at the product at that store,
// so the row can say where. A like is not a store visit.
const STORE_VISITS = new Set(['scanned', 'viewed', 'viewed-from-search', 'viewed-from-recommendation']);

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
    listProductHistory({ query, limit: PAGE_SIZE })
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
  }, [requestKey, query]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await listProductHistory({ query, limit: PAGE_SIZE, cursor: nextCursor });
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
  const compareProblem = selectionProblem(selectedIds.length);

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
        await unlikeProduct(productId);
      } else {
        await likeProduct(productId);
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
        <ThemedView style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary">
            {loading && items.length === 0 ? 'Loading your activity' : ''}
          </ThemedText>
        </ThemedView>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Search your product history"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        <ThemedView
          type="backgroundElement"
          style={styles.compareToolbar}
        >
          <View style={styles.compareToolbarText}>
            <ThemedText type="smallBold">
              Compare products
            </ThemedText>

            <ThemedText type="small" themeColor="textSecondary">
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
              <ThemedText type="linkPrimary">
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
        </ThemedView>

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
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              {section.title}
            </ThemedText>
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
                    event={`${EVENT_LABELS[item.interaction] ?? item.interaction} · ${formatTime(
                      item.occurred_at,
                    )}`}
                    // Where the event happened, from the row's own flat fields. The
              // nested product.store_inventory is today's price, not the event's.
              // Only the interaction types that mean "was looking at it here"
              // get the location line; a like is not a store visit.
              meta={[
                STORE_VISITS.has(item.interaction) && item.store_name
                  ? `Viewed at ${item.store_name} location.`
                  : null,
                // Past price, explicitly labelled: it can differ from today's
                // price at the same store, and is null on older events.
                item.price_at_interaction != null
                  ? `$${Number(item.price_at_interaction).toFixed(2)} when you were here`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || null}
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
    paddingHorizontal: Spacing.three,
    // The segment control above this stack already handles the top inset
    paddingTop: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  header: {
    gap: Spacing.half,
  },
  search: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  message: {
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  list: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  sectionTitle: {    paddingTop: Spacing.two,
  },
  compareToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
  },
  compareToolbarText: {
    flex: 1,
    gap: Spacing.half,
  },
  compareButton: {
    backgroundColor: '#3c87f7',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  compareButtonDisabled: {
    opacity: 0.4,
  },
  compareButtonText: {
    color: '#ffffff',
    fontWeight: '600',
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
    borderColor: '#3c87f7',
    backgroundColor: '#3c87f7',
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
