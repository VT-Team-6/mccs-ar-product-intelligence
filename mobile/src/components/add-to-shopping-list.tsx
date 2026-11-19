
import { useFocusEffect } from 'expo-router';
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
  type ShoppingList,
  type ShoppingListSummary,
} from '@/api/shopping-lists';

import { useAuth } from '@/auth/AuthContext';
import { useSignInPrompt } from '@/auth/use-sign-in-prompt';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  productId: number;
  // Called after the product is added, so the page can refresh its list status
  onAdded?: () => void;
};

export function AddToShoppingList({ productId, onAdded }: Props) {
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
  const theme = useTheme();

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
    setVisible(true);
  };

  const addToList = async (listId: number) => {
    if (savingListId !== null) return;

    setSavingListId(listId);
    setError(null);

    try {
      const updated = await addShoppingListItem(
        listId,
        productId,
      );

      setListItems((previous) => ({
        ...previous,
        [listId]: updated,
      }));

      setMessage(`Added to ${updated.name}.`);
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
              <ThemedText type="subtitle">
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
              Choose which shopping list should receive this product.
            </ThemedText>

            {loading && <ActivityIndicator />}

            {error && (
              <ThemedText>{error}</ThemedText>
            )}

            {message && (
              <ThemedText style={styles.successText}>
                {message}
              </ThemedText>
            )}

            {!loading && lists.length === 0 && !error && (
              <ThemedText themeColor="textSecondary">
                You don't have a shopping list yet.
                Create one from Products → Shopping List.
              </ThemedText>
            )}

            <ScrollView
              style={styles.listScroll}
              keyboardShouldPersistTaps="handled"
            >
              {lists.map((list) => {
                const alreadyAdded =
                  listItems[list.shopping_list_id]?.items.some(
                    (item) => item.product_id === productId,
                  ) ?? false;

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

                      {list.is_active && (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                        >
                          Active list
                        </ThemedText>
                      )}
                    </View>

                    {alreadyAdded ? (
                      <ThemedText style={styles.successText}>
                        ✓ Added
                      </ThemedText>
                    ) : (
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
  listScroll: {
    flexGrow: 0,
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
});
