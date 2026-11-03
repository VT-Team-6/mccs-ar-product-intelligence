import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { likeProduct, listProductHistory, unlikeProduct, type HistoryItem } from '@/api/me';
import { ProductCard } from '@/components/product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';

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

  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim());
  const [reloadKey, setReloadKey] = useState(0);

  const requestKey = `${query}\u0000${reloadKey}`;
  const [page, setPage] = useState<LoadedHistory | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

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
          renderItem={({ item }) => (
            <ProductCard
              product={item.product}
              isLiked={item.product.is_liked}
              onToggleLike={() => toggleLike(item)}
              event={`${EVENT_LABELS[item.interaction] ?? item.interaction} · ${formatTime(
                item.occurred_at,
              )}`}
              onPress={() =>
                router.push({
                  pathname: '/product/[id]',
                  params: { id: String(item.product.product_id), from: '/products/history' },
                })
              }
            />
          )}
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
