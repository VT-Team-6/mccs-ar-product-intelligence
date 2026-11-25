
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  addShoppingListItem,
  getShoppingList,
  listShoppingLists,
  MAX_LIST_QUANTITY,
  samePick,
  type ShoppingList,
  type ShoppingListSummary,
} from '@/api/shopping-lists';

import { useAuth } from '@/auth/AuthContext';
import { useSignInPrompt } from '@/auth/use-sign-in-prompt';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { QuantityField } from '@/components/ui/quantity-field';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  productId: number;
  // The size/color picked on the product page; null for any
  variantId?: number | null;
  // A color picked without a size (saved as that color, any size)
  color?: string | null;
  variantLabel?: string | null;
  // Called after the product is added, so the page can refresh its list status
  onAdded?: () => void;
};

export function AddToShoppingList({ productId, variantId = null, color = null, variantLabel = null, onAdded }: Props) {
  const { user } = useAuth();
  const promptSignIn = useSignInPrompt();
  const [visible, setVisible] = useState(false);
  const [lists, setLists] = useState<ShoppingListSummary[]>([]);
  const [listItems, setListItems] = useState<
    Record<number, ShoppingList>
  >({});
  const [loading, setLoading] = useState(false);
  const [savingListId, setSavingListId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // How many to add
  const [quantity, setQuantity] = useState(1);
  const theme = useTheme();
  const router = useRouter();

  // Closes the dialog and opens the Shopping List screen
  const goToLists = () => {
    setVisible(false);
    router.push('/products/shopping-list' as Href);
  };

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const summaries = await listShoppingLists();
      const details = await Promise.all(
        summaries.map((list) =>
          getShoppingList(list.shopping_list_id),
        ),
      );

      const byId: Record<number, ShoppingList> = {};

      for (const list of details) {
        byId[list.shopping_list_id] = list;
      }

      setLists(summaries);
      setListItems(byId);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : 'Could not load shopping lists.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh saved-list membership when returning to this product.
  useFocusEffect(
    useCallback(() => {
      if (visible && user) {
        void loadLists();
      }
    }, [visible, user, loadLists]),
  );

  const openPicker = () => {
    if (!user) {
      void promptSignIn('Sign in to add products to a shopping list.');
      return;
    }
    setMessage(null);
    setError(null);
    setQuantity(1);
    setVisible(true);
  };

  const addToList = async (listId: number) => {
    if (savingListId !== null) return;

    setSavingListId(listId);
    setError(null);

    try {
      const before = listItems[listId]?.items.find((item) => samePick(item, productId, variantId, color));
      const updated = await addShoppingListItem(listId, productId, variantId, color, quantity);

      setListItems((previous) => ({
        ...previous,
        [listId]: updated,
      }));

      // "Added 2 Black / 10 to Weekend." or, when it was already there, "(now 3)"
      const now = updated.items.find((item) => samePick(item, productId, variantId, color))?.quantity ?? quantity;
      const what = [quantity > 1 ? String(quantity) : null, variantLabel].filter(Boolean).join(' ');
      setMessage(
        `Added ${what ? `${what} ` : ''}to ${updated.name}${before ? ` (now ${now})` : ''}.`,
      );
      onAdded?.();
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : 'Could not add product.',
      );
    } finally {
      setSavingListId(null);
    }
  };

  return (
    <>
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel="Add to Shopping List"
        style={({ pressed }) => [
          styles.openButton,
          { backgroundColor: theme.card, borderColor: theme.link },
          pressed && styles.disabled,
        ]}
      >
        <ThemedText type="smallBold" themeColor="link">
          ＋ Add to Shopping List
        </ThemedText>
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.overlay}>
          <ThemedView
            type="card"
            style={[styles.dialog, { borderColor: theme.border }]}
          >
            <View style={styles.header}>
              {/* The title wraps instead of pushing Close out of the box */}
              <ThemedText type="subtitle" style={styles.title}>
                Add to Shopping List
              </ThemedText>

              <Pressable
                onPress={() => setVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close list picker"
                hitSlop={10}
              >
                <ThemedText type="linkPrimary">
                  Close
                </ThemedText>
              </Pressable>
            </View>

            <ThemedText themeColor="textSecondary">
              {variantLabel
                ? `Choose which shopping list should get ${variantLabel}.`
                : 'Choose which shopping list should receive this product.'}
            </ThemedText>

            {/* How many to add: − 1 + */}
            <View style={styles.quantityRow}>
              <ThemedText type="smallBold">Quantity</ThemedText>
              <View style={[styles.stepper, { borderColor: theme.border }]}>
                <Pressable
                  onPress={() => setQuantity((n) => Math.max(1, n - 1))}
                  disabled={quantity <= 1}
                  accessibilityRole="button"
                  accessibilityLabel="One fewer"
                  hitSlop={6}
                  style={[styles.stepButton, quantity <= 1 && styles.disabled]}
                >
                  <ThemedText type="subtitle" style={styles.stepText}>−</ThemedText>
                </Pressable>
                <QuantityField
                  value={quantity}
                  onChange={setQuantity}
                  max={MAX_LIST_QUANTITY}
                  live
                  accessibilityLabel="Quantity"
                  style={styles.stepCount}
                />
                <Pressable
                  onPress={() => setQuantity((n) => Math.min(MAX_LIST_QUANTITY, n + 1))}
                  disabled={quantity >= MAX_LIST_QUANTITY}
                  accessibilityRole="button"
                  accessibilityLabel="One more"
                  hitSlop={6}
                  style={[styles.stepButton, quantity >= MAX_LIST_QUANTITY && styles.disabled]}
                >
                  <ThemedText type="subtitle" style={styles.stepText}>+</ThemedText>
                </Pressable>
              </View>
            </View>

            {loading && <ActivityIndicator />}

            {error && (
              <ThemedText>{error}</ThemedText>
            )}

            {message && (
              <View style={styles.messageRow}>
                <ThemedText style={styles.successText}>
                  {message}
                </ThemedText>
                <Pressable onPress={goToLists} accessibilityRole="link" hitSlop={8}>
                  <ThemedText type="linkPrimary">View list ›</ThemedText>
                </Pressable>
              </View>
            )}

            {!loading && lists.length === 0 && !error && (
              <View style={styles.emptyState}>
                <ThemedText themeColor="textSecondary">
                  You don't have a shopping list yet.
                </ThemedText>
                <Pressable
                  onPress={goToLists}
                  accessibilityRole="button"
                  style={styles.addButton}>
                  <ThemedText style={styles.addButtonText}>Create a shopping list</ThemedText>
                </Pressable>
              </View>
            )}

            <ScrollView
              style={styles.listScroll}
              keyboardShouldPersistTaps="handled"
            >
              {lists.map((list) => {
                // This product with the same pick already on that list
                const onList = listItems[list.shopping_list_id]?.items.find((item) =>
                  samePick(item, productId, variantId, color),
                );

                const saving =
                  savingListId === list.shopping_list_id;

                return (
                  <View
                    key={list.shopping_list_id}
                    style={styles.listRow}
                  >
                    <View style={styles.listInformation}>
                      <ThemedText type="smallBold">
                        {list.name}
                      </ThemedText>

                      {(list.is_active || onList) && (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                        >
                          {[list.is_active ? 'Active list' : null, onList ? `On it: ${onList.quantity ?? 1}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </ThemedText>
                      )}
                    </View>

                    {(
                      <Pressable
                        disabled={savingListId !== null}
                        onPress={() =>
                          void addToList(list.shopping_list_id)
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Add to ${list.name}`}
                        style={[
                          styles.addButton,
                          savingListId !== null && styles.disabled,
                        ]}
                      >
                        {saving ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <ThemedText style={styles.addButtonText}>
                            Add
                          </ThemedText>
                        )}
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Navy outline, the secondary action next to Save to Likes (see UI_STANDARDS.md)
  openButton: {
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '75%',
    alignSelf: 'center',
    padding: Spacing.four,
    borderRadius: Radius.large,
    borderWidth: 1,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
  },
  listScroll: {
    flexGrow: 0,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.medium,
  },
  stepButton: {
    width: 40,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    fontSize: 22,
    lineHeight: 26,
  },
  stepCount: {
    minWidth: 28,
    textAlign: 'center',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  listInformation: {
    flex: 1,
    gap: Spacing.half,
  },
  addButton: {
    backgroundColor: Brand.navy,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 64,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  successText: {
    color: Brand.success,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  // The message wraps inside the box, with "View list ›" under it
  messageRow: {
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  emptyState: {
    gap: Spacing.three,
    alignItems: 'flex-start',
  },
});
