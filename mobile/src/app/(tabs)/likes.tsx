import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  likeProduct,
  listLikedProducts,
  unlikeProduct,
  type LikedProduct,
  type LikedSort,
} from '@/api/me';
import { ProductCard } from '@/components/product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';

const PAGE_SIZE = 20;

// Defines the sort options available to the user. 
const SORTS: { value: LikedSort; label: string }[] = [
  { value: 'recent', label: 'Recently liked' },
  { value: 'name', label: 'Name: A–Z' },
  { value: 'rating', label: 'Rating' },
  { value: 'price', label: 'Price' },
];

// What one loaded page of Likes looks like, tagged with the request it answers
// so a slow response can never overwrite a newer search.
type LoadedLikes = {
  key: string;
  items: LikedProduct[];
  nextCursor: string | null;
  error: string | null;
};

// Likes is the user's current saved collection, so unlike removes the card here
// but leaves the earlier interaction in History.
export default function LikesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // The search text, debounced for the backend request
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim());
  const [sort, setSort] = useState<LikedSort>('recent');
  const [reloadKey, setReloadKey] = useState(0);

  // Creates a unique key for this request, so a slow response can't overwrite a newer one.
  const requestKey = `${query}\u0000${sort}\u0000${reloadKey}`;
  const [page, setPage] = useState<LoadedLikes | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // What an unlike just removed, so UNDO can put it back
  const [undoItem, setUndoItem] = useState<LikedProduct | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A page for an older request is stale: keep showing it while the new one loads
  const items = page?.items ?? [];
  const nextCursor = page?.nextCursor ?? null;
  const error = page?.key === requestKey ? page?.error ?? null : null;
  const loading = page?.key !== requestKey;

  // Reloads when the tab comes back into view, so a like made on the product
  // page shows up here.
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

  // Loads the first page of Likes, or a new search/sort. The backend returns
  // the user's most recent likes first, so we don't need to sort them here.
  useEffect(() => {
    let cancelled = false;
    listLikedProducts({ query, sort, limit: PAGE_SIZE })
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
  }, [requestKey, query, sort]);

  // Stops the undo timer if the screen goes away
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  // Loads the next page of Likes, if any. 
  // The backend returns the user's most recent likes first, so we don't need to sort them here.
  const loadMore = async () => {
    // Don't load more if there's no next page or if we're already loading more
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await listLikedProducts({
        query,
        sort,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      // Check the request key to ensure this response is for the current request, not a stale one
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

  // Removes the card straight away, then tells the backend. If that fails the
  // card comes back and the user sees why.
  const removeLike = async (product: LikedProduct) => {
    setPage((current) =>
      current
        ? {
            ...current,
            items: current.items.filter((item) => item.product_id !== product.product_id),
          }
        : current,
    );
    setUndoItem(product);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoItem(null), 6000);

    try {
      await unlikeProduct(product.product_id);
    } catch (problem) {
      setUndoItem(null);
      setPage((current) =>
        current
          ? { ...current, error: errorMessage(problem) }
          : { key: requestKey, items: [], nextCursor: null, error: errorMessage(problem) },
      );
      setReloadKey((key) => key + 1);
    }
  };

  // Undoes the last remove, if any. The undo timer is cleared so the user can't
  // undo twice in a row.
  const undoRemove = async () => {
    const item = undoItem;
    if (!item) return;
    setUndoItem(null);
    setPage((current) =>
      current ? { ...current, items: [item, ...current.items] } : current,
    );
    try {
      await likeProduct(item.product_id);
    } catch (problem) {
      setPage((current) =>
        current
          ? { ...current, error: errorMessage(problem) }
          : { key: requestKey, items: [], nextCursor: null, error: errorMessage(problem) },
      );
      setReloadKey((key) => key + 1);
    }
  };

  // Counts the number of saved products, and adds a "+" if there are more to load.
  // If empty, shows a loading message if we're still waiting for the first page.
  const countLabel = () => {
    if (loading && items.length === 0) return 'Loading your saved products';
    if (items.length === 0) return '';
    const saved = `${items.length}${nextCursor ? '+' : ''} saved ${
      items.length === 1 ? 'product' : 'products'
    }`;
    return saved;
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ThemedView style={styles.header}>
          <ThemedText type="subtitle">Liked Products</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {countLabel()}
          </ThemedText>
        </ThemedView>


        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Search liked products"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        {/* Creates sort options */}
        <ThemedView style={styles.sorts}>
          {SORTS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setSort(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === option.value }}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type={sort === option.value ? 'backgroundSelected' : 'backgroundElement'}
                style={styles.chip}>
                <ThemedText type="small">{option.label}</ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </ThemedView>

        {/* Shows the error message for the current request, not a stale one */}
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

        <FlatList
          data={items}
          keyExtractor={(product) => String(product.product_id)}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              isLiked
              onToggleLike={() => removeLike(item)}
              meta={`Liked ${formatLikedDate(item.liked_at)}`}
              onPress={() =>
                router.push({
                  pathname: '/product/[id]',
                  params: { id: String(item.product_id), from: '/likes' },
                })
              }
            />
          )}
          ListEmptyComponent={
            !loading && !error ? (
              <EmptyLikes
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

        {undoItem && (
          <ThemedView
            type="backgroundSelected"
            style={[styles.undo, { bottom: insets.bottom + BottomTabInset + Spacing.three }]}>
            <ThemedText type="small">Product removed from Likes.</ThemedText>
            <Pressable
              onPress={undoRemove}
              accessibilityRole="button"
              accessibilityLabel={`Undo removing ${undoItem.name} from Likes`}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="linkPrimary">UNDO</ThemedText>
            </Pressable>
          </ThemedView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

// Shows a message when there are no liked products, or when a search returns no results.
function EmptyLikes({
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
        <ThemedText themeColor="textSecondary">{`No liked products match "${query}".`}</ThemedText>
        <Pressable onPress={onClear} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="linkPrimary">Clear search</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.message}>
      <ThemedText type="smallBold">No saved products yet</ThemedText>
      <ThemedText themeColor="textSecondary">
        Tap the heart on a product to save it here.
      </ThemedText>
      <Pressable onPress={onBrowse} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedText type="linkPrimary">Browse products</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

// "Oct 18", with the year too when the like is from an earlier year
function formatLikedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function errorMessage(problem: unknown): string {
  if (problem instanceof TypeError) {
    return 'Could not reach the backend. Is it running?';
  }
  if (problem instanceof Error) {
    return problem.message;
  }
  return 'Could not load your likes.';
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
    // On web the tab bar sits at the top, so leave room for it
    paddingTop: Platform.OS === 'web' ? Spacing.six + Spacing.four : Spacing.three,
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
  sorts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingVertical: Spacing.one + Spacing.half,
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
  loadMore: {
    paddingVertical: Spacing.two,
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  undo: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});
