import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  activateShoppingList,
  createShoppingList,
  getShoppingList,
  listShoppingLists,
  removeShoppingListItem,
  setShoppingListItemCompleted,
  type ShoppingList,
  type ShoppingListItem,
  type ShoppingListSummary,
} from '@/api/shopping-lists';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  BottomTabInset,
  Brand,
  MaxContentWidth,
  Radius,
  Spacing,
} from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  searchProducts,
  type Product,
  productImageUrl,
} from '@/api/products';
import { Image } from 'expo-image';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { addShoppingListItem } from '@/api/shopping-lists';

export default function ShoppingListScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [lists, setLists] = useState<ShoppingListSummary[]>([]);
  const [current, setCurrent] = useState<ShoppingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showListPicker, setShowListPicker] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [searchText, setSearchText] = useState('');
  const searchQuery = useDebouncedValue(searchText.trim());

  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addingProductId, setAddingProductId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const available = await listShoppingLists();
      setLists(available);

      if (!available.length) {
        setCurrent(null);
        return;
      }

      // Preserve the selected list when returning from another page.
      // Otherwise select the active list or the first available list.
      const chosen =
        available.find(
          (list) =>
            list.shopping_list_id === current?.shopping_list_id,
        ) ??
        available.find((list) => list.is_active) ??
        available[0];

      const loaded = await getShoppingList(chosen.shopping_list_id);
      setCurrent(loaded);
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setLoading(false);
    }
  }, [current?.shopping_list_id]);

  // Refresh when returning from product search or product details.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const createList = async () => {
    const name = newListName.trim();

    if (!name) {
      setError('Enter a name for your shopping list.');
      return;
    }

    if (name.length > 100) {
      setError('List names must be 100 characters or fewer.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const created = await createShoppingList(name);
      setCurrent(created);
      setLists(await listShoppingLists());
      setNewListName('');
      setShowCreateForm(false);
      setShowListPicker(false);
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setBusy(false);
    }
  };

  const selectList = async (listId: number) => {
    setBusy(true);
    setError(null);

    try {
      // Selecting a list also makes it active for future scanning.
      const loaded = await activateShoppingList(listId);
      setCurrent(loaded);
      setLists(await listShoppingLists());
      setShowListPicker(false);
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setBusy(false);
    }
  };

  const updateCompleted = async (
    item: ShoppingListItem,
    completed: boolean,
  ) => {
    if (!current || busy) return;

    setBusy(true);
    setError(null);

    try {
      const updated = await setShoppingListItemCompleted(
        current.shopping_list_id,
        item.product_id,
        completed,
      );
      setCurrent(updated);
      setLists(await listShoppingLists());
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (item: ShoppingListItem) => {
    if (!current || busy) return;

    setBusy(true);
    setError(null);

    try {
      const updated = await removeShoppingListItem(
        current.shopping_list_id,
        item.product_id,
      );
      setCurrent(updated);
      setLists(await listShoppingLists());
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    if (!searchQuery || !current) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    searchProducts(searchQuery)
      .then((products) => {
        if (!cancelled) {
          setSearchResults(products);
        }
      })
      .catch((problem: unknown) => {
        if (!cancelled) {
          setSearchResults([]);
          setSearchError(
            problem instanceof Error
              ? problem.message
              : 'Could not search products.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSearchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [searchQuery, current?.shopping_list_id]);

  // Add a result directly to the currently selected shopping list.
  const addSearchResult = async (productId: number) => {
    if (!current || addingProductId !== null || busy) return;

    const listId = current.shopping_list_id;

    setAddingProductId(productId);
    setSearchError(null);

    try {
      const updated = await addShoppingListItem(listId, productId);

      // Don't display a response from an older list if the selection
      // changed while the request was in progress.
      setCurrent((existing) =>
        existing?.shopping_list_id === listId ? updated : existing,
      );

      setLists(await listShoppingLists());
    } catch (problem) {
      setSearchError(
        problem instanceof Error
          ? problem.message
          : 'Could not add product.',
      );
    } finally {
      setAddingProductId(null);
    }
  };


  const remaining =
    current?.items.filter((item) => !item.is_completed) ?? [];
  const completed =
    current?.items.filter((item) => item.is_completed) ?? [];

  const total = current?.total_items ?? 0;
  const completedCount = current?.completed_items ?? 0;
  const progress = total ? completedCount / total : 0;

  const itemRow = (item: ShoppingListItem) => (
    <View key={item.shopping_list_item_id} style={styles.itemRow}>
      <Pressable
        disabled={busy}
        onPress={() => updateCompleted(item, !item.is_completed)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.is_completed }}
        accessibilityLabel={`Mark ${item.name} ${
          item.is_completed ? 'incomplete' : 'completed'
        }`}
        style={[
          styles.checkbox,
          {
            borderColor: item.is_completed
              ? Brand.success
              : theme.textSecondary,
            backgroundColor: item.is_completed
              ? Brand.success
              : 'transparent',
          },
        ]}
      >
        {item.is_completed && (
          <ThemedText style={styles.checkmark}>✓</ThemedText>
        )}
      </Pressable>

      <Pressable
        style={styles.itemDetails}
        onPress={() =>
          router.push({
            pathname: '/product/[id]',
            params: {
              id: String(item.product_id),
              from: '/products/shopping-list',
            },
          })
        }
      >
        <ThemedText
          type="smallBold"
          style={item.is_completed ? styles.completedText : undefined}
        >
          {item.name}
        </ThemedText>

        <ThemedText
          type="small"
          themeColor="textSecondary"
        >
          {[item.brand, item.product_type].filter(Boolean).join(' · ')}
        </ThemedText>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={() => removeItem(item)}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.name}`}
        hitSlop={10}
      >
        <ThemedText type="linkPrimary">Remove</ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView
        edges={['left', 'right']}
        style={styles.safeArea}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                insets.bottom + BottomTabInset + Spacing.four,
            },
          ]}
        >
          <ThemedText type="subtitle">
            Shopping List
          </ThemedText>

          <ThemedText themeColor="textSecondary">
            Create lists, plan your shopping, and check off items.
          </ThemedText>

          {loading && <ActivityIndicator />}

          {error && (
            <ThemedView
              type="backgroundElement"
              style={styles.message}
            >
              <ThemedText>{error}</ThemedText>
              <Pressable onPress={() => void refresh()}>
                <ThemedText type="linkPrimary">
                  Try again
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {!loading && (
            <>
              {/* List selector and create button */}
              <View style={styles.selectorRow}>
                <Pressable
                  style={[
                    styles.selector,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                  onPress={() =>
                    setShowListPicker((open) => !open)
                  }
                  disabled={busy}
                >
                  <ThemedText type="smallBold">
                    {current?.name ?? 'Select a shopping list'}
                  </ThemedText>
                  <ThemedText
                    style={{
                        fontSize: 19,
                        fontWeight: '600',
                        color: theme.textSecondary,
                        marginLeft: Spacing.two,
                    }}
                  >
                    ▾
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={[
                    styles.newButton,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                  onPress={() => setShowCreateForm((open) => !open)}
                  disabled={busy}
                >
                  <ThemedText type="smallBold">
                    + New
                  </ThemedText>
                </Pressable>
              </View>

              {showListPicker && (
                <ThemedView
                  type="backgroundElement"
                  style={styles.picker}
                >
                  {lists.map((list) => (
                    <Pressable
                      key={list.shopping_list_id}
                      onPress={() =>
                        void selectList(list.shopping_list_id)
                      }
                      style={styles.pickerOption}
                    >
                      <ThemedText>
                        {list.name}
                        {list.is_active ? ' ✓' : ''}
                      </ThemedText>
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                      >
                        {list.completed_items}/{list.total_items}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ThemedView>
              )}

              {showCreateForm && (
                <ThemedView
                  type="backgroundElement"
                  style={styles.createForm}
                >
                  <ThemedText type="smallBold">
                    New shopping list
                  </ThemedText>

                  <TextInput
                    value={newListName}
                    onChangeText={setNewListName}
                    placeholder="e.g. Weekly Shopping"
                    placeholderTextColor={theme.textSecondary}
                    maxLength={100}
                    style={[
                      styles.textInput,
                      {
                        color: theme.text,
                        borderColor: theme.textSecondary,
                      },
                    ]}
                  />

                  <Pressable
                    disabled={busy || !newListName.trim()}
                    style={styles.primaryButton}
                    onPress={() => void createList()}
                  >
                    <ThemedText style={styles.primaryButtonText}>
                      Create List
                    </ThemedText>
                  </Pressable>
                </ThemedView>
              )}

              {!current ? (
                <ThemedView style={styles.empty}>
                  <ThemedText type="smallBold">
                    No shopping lists yet
                  </ThemedText>
                  <ThemedText themeColor="textSecondary">
                    Select + New to create your first list.
                  </ThemedText>
                </ThemedView>
              ) : (
                <>
                  {/* Progress */}
                  <View style={styles.progressHeader}>
                    <ThemedText type="smallBold">
                      {completedCount} of {total} completed
                    </ThemedText>
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                    >
                      {Math.round(progress * 100)}%
                    </ThemedText>
                  </View>

                  <View
                    style={[
                      styles.progressTrack,
                      { backgroundColor: theme.backgroundElement },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${progress * 100}%` },
                      ]}
                    />
                  </View>

                  {/* Incomplete products */}
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <ThemedText type="smallBold">
                        Items to Buy
                      </ThemedText>
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                      >
                        {remaining.length} remaining
                      </ThemedText>
                    </View>

                    {remaining.length ? (
                      remaining.map(itemRow)
                    ) : (
                      <ThemedText themeColor="textSecondary">
                        No remaining items.
                      </ThemedText>
                    )}
                  </View>

                  {/* Completed products */}
                  <View style={styles.section}>
                    <ThemedText type="smallBold">
                      Completed ({completed.length})
                    </ThemedText>

                    {completed.length ? (
                      completed.map(itemRow)
                    ) : (
                      <ThemedText themeColor="textSecondary">
                        No completed items yet.
                      </ThemedText>
                    )}
                  </View>
                </>
              )}

              {/* Inline product search and direct add-to-list controls. */}
              <View style={styles.section}>
                <TextInput
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholder="Search products to add to your list"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  accessibilityLabel="Search products to add to your list"
                  style={[
                    styles.search,
                    {
                      color: theme.text,
                      backgroundColor: theme.backgroundElement,
                    },
                  ]}
                />

                {searchLoading && <ActivityIndicator />}

                {searchError && (
                  <ThemedText themeColor="textSecondary">
                    {searchError}
                  </ThemedText>
                )}

                {!searchLoading && searchQuery.length > 0 && current && (
                  <ThemedView
                    type="backgroundElement"
                    style={styles.searchResultsContainer}
                  >
                    <ThemedText type="smallBold">
                        Matching products
                    </ThemedText>

                    {searchResults.length === 0 && !searchError ? (
                        <ThemedText themeColor="textSecondary">
                        No products match "{searchQuery}".
                        </ThemedText>
                    ) : (
                        searchResults.map((product) => {
                        const alreadyAdded = current.items.some(
                            (item) => item.product_id === product.product_id,
                        );

                        const adding =
                            addingProductId === product.product_id;

                        const imageUrl = productImageUrl(product);

                        return (
                            <View
                            key={product.product_id}
                            style={styles.searchResultRow}
                            >
                            {/* Product info opens the existing details screen. */}
                            <Pressable
                                style={styles.searchResultProduct}
                                onPress={() =>
                                router.push({
                                    pathname: '/product/[id]',
                                    params: {
                                    id: String(product.product_id),
                                    from: '/products/shopping-list',
                                    },
                                })
                                }
                            >
                                {imageUrl ? (
                                <Image
                                    source={{ uri: imageUrl }}
                                    style={styles.searchResultImage}
                                    contentFit="contain"
                                />
                                ) : (
                                <ThemedView
                                    style={[
                                    styles.searchResultImage,
                                    styles.searchResultPlaceholder,
                                    ]}
                                >
                                    <ThemedText
                                        type="small"
                                        themeColor="textSecondary"
                                        >
                                        No image
                                    </ThemedText>
                                </ThemedView>
                                )}

                                <View style={styles.searchResultDetails}>
                                <ThemedText type="smallBold">
                                    {product.name}
                                </ThemedText>

                                <ThemedText
                                    type="small"
                                    themeColor="textSecondary"
                                >
                                    {[product.brand, product.product_type]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </ThemedText>
                                </View>
                            </Pressable>

                            {/* Only the plus button adds; it never completes an item. */}
                            {alreadyAdded ? (
                                <View style={styles.addedIndicator}>
                                <ThemedText
                                    type="smallBold"
                                    style={styles.addedText}
                                >
                                    ✓ Added
                                </ThemedText>
                                </View>
                            ) : (
                                <Pressable
                                disabled={addingProductId !== null || busy}
                                onPress={() =>
                                    void addSearchResult(product.product_id)
                                }
                                accessibilityRole="button"
                                accessibilityLabel={`Add ${product.name} to ${current.name}`}
                                style={[
                                    styles.addResultButton,
                                    (addingProductId !== null || busy) &&
                                    styles.disabled,
                                ]}
                                >
                                {adding ? (
                                    <ActivityIndicator size="small" />
                                ) : (
                                    <ThemedText style={styles.addResultButtonText}>
                                    +
                                    </ThemedText>
                                )}
                                </Pressable>
                            )}
                            </View>
                        );
                        })
                    )}
                    </ThemedView>
                )}
              </View>

              {/* In-Store shopping mode*/}
              <Pressable
                disabled={!current}
                style={[
                  styles.primaryButton,
                  !current && styles.disabled,
                ]}
                onPress={() => router.push('/products/in-store')}
              >
                <ThemedText style={styles.primaryButtonText}>
                  In-Store Shopping Mode
                </ThemedText>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function messageOf(problem: unknown): string {
  if (problem instanceof TypeError) {
    return 'Could not reach the backend. Is it running?';
  }
  return problem instanceof Error
    ? problem.message
    : 'Something went wrong.';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  selectorRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  selector: {
    flex: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  newButton: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  picker: {
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: Spacing.one,
  },
  pickerOption: {
    padding: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  createForm: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    fontSize: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressTrack: {
    height: 8,
    borderRadius: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Brand.success,
    borderRadius: 10,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  checkbox: {
    height: 24,
    width: 24,
    borderWidth: 2,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#fff',
    fontWeight: '700',
  },
  itemDetails: {
    flex: 1,
    gap: Spacing.half,
  },
  completedText: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  search: {
    borderRadius: Radius.medium,
    padding: Spacing.three,
    fontSize: 16,
  },
  // MCCS red: the main action (see UI_STANDARDS.md)
  primaryButton: {
    backgroundColor: Brand.red,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
  message: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
    gap: Spacing.two,
  },
  searchResultsContainer: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  searchResultProduct: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minWidth: 0,
  },
  searchResultImage: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
  },
  searchResultPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchResultDetails: {
    flex: 1,
    gap: Spacing.half,
  },
  addResultButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.small,
    backgroundColor: Brand.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addResultButtonText: {
    fontSize: 27,
    color: '#ffffff',
    fontWeight: '500',
  },
  addedIndicator: {
    paddingHorizontal: Spacing.one,
  },
  addedText: {
    color: Brand.success,
  },
});
