import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  getShoppingList,
  listShoppingLists,
  setShoppingListItemCompleted,
  type ShoppingList,
  type ShoppingListItem,
} from '@/api/shopping-lists';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  BottomTabInset,
  MaxContentWidth,
  Spacing,
} from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function InStoreShoppingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [list, setList] = useState<ShoppingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadActiveList = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const lists = await listShoppingLists();
      const activeList = lists.find((item) => item.is_active);

      if (!activeList) {
        setList(null);
        return;
      }

      const details = await getShoppingList(
        activeList.shopping_list_id,
      );

      setList(details);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : 'Could not load your shopping list.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever this screen comes into focus.
  useFocusEffect(
    useCallback(() => {
      void loadActiveList();
    }, [loadActiveList]),
  );

  // Manual check-off is shared with the normal shopping-list screen.
  const toggleCompleted = async (item: ShoppingListItem) => {
    if (!list || busy) return;

    setBusy(true);
    setError(null);

    try {
      const updated = await setShoppingListItemCompleted(
        list.shopping_list_id,
        item.product_id,
        !item.is_completed,
      );

      setList(updated);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : 'Could not update the item.',
      );
    } finally {
      setBusy(false);
    }
  };

  const remaining =
    list?.items.filter((item) => !item.is_completed) ?? [];

  const completed =
    list?.items.filter((item) => item.is_completed) ?? [];

  const total = list?.total_items ?? 0;
  const completedCount = list?.completed_items ?? 0;

  const progress = total > 0
    ? completedCount / total
    : 0;

  const renderItem = (item: ShoppingListItem) => (
    <Pressable
      key={item.shopping_list_item_id}
      disabled={busy}
      onPress={() => void toggleCompleted(item)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.is_completed }}
      accessibilityLabel={`${item.is_completed ? 'Uncheck' : 'Complete'} ${item.name}`}
      style={[
        styles.item,
        { backgroundColor: theme.backgroundElement },
      ]}
    >
      <View
        style={[
          styles.checkbox,
          {
            borderColor: item.is_completed
              ? '#23865c'
              : theme.textSecondary,
            backgroundColor: item.is_completed
              ? '#23865c'
              : 'transparent',
          },
        ]}
      >
        {item.is_completed && (
          <ThemedText style={styles.checkmark}>✓</ThemedText>
        )}
      </View>

      <View style={styles.itemInformation}>
        <ThemedText
          type="smallBold"
          style={
            item.is_completed
              ? styles.completedText
              : undefined
          }
        >
          {item.name}
        </ThemedText>

        <ThemedText
          type="small"
          themeColor="textSecondary"
        >
          {item.brand ?? item.product_type}
        </ThemedText>
      </View>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView
        edges={['left', 'right']}
        style={styles.safeArea}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                insets.bottom + BottomTabInset + Spacing.four,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText type="subtitle">
                In-Store Shopping
              </ThemedText>

              <ThemedText
                type="small"
                themeColor="textSecondary"
              >
                {list
                  ? `${list.name} · Active list`
                  : 'Shopping mode'}
              </ThemedText>
            </View>

            <ThemedView
              type="backgroundElement"
              style={styles.badge}
            >
              <ThemedText style={styles.badgeText}>
                Shopping
              </ThemedText>
            </ThemedView>
          </View>

          {loading && <ActivityIndicator />}

          {error && (
            <ThemedView
              type="backgroundElement"
              style={styles.message}
            >
              <ThemedText>{error}</ThemedText>
              <Pressable onPress={() => void loadActiveList()}>
                <ThemedText type="linkPrimary">
                  Try again
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {!loading && !list && !error && (
            <ThemedView style={styles.message}>
              <ThemedText type="smallBold">
                No active shopping list
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                Create or select a list from Shopping List
                before entering shopping mode.
              </ThemedText>
            </ThemedView>
          )}

          {!loading && list && (
            <>
              {/* Progress card */}
              <ThemedView
                type="backgroundElement"
                style={styles.progressCard}
              >
                <ThemedText type="subtitle">
                  {remaining.length} items remaining
                </ThemedText>

                <ThemedText themeColor="textSecondary">
                  Scan products as you find them, or check
                  them off manually.
                </ThemedText>

                <View
                  style={[
                    styles.progressTrack,
                    { backgroundColor: theme.background },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${progress * 100}%` },
                    ]}
                  />
                </View>

                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                >
                  {completedCount} of {total} completed
                </ThemedText>
              </ThemedView>

              {/* Remaining products */}
              <View style={styles.section}>
                <ThemedText type="smallBold">
                  Still needed
                </ThemedText>

                {remaining.length > 0 ? (
                  remaining.map(renderItem)
                ) : (
                  <ThemedText themeColor="textSecondary">
                    {total > 0
                      ? 'All items completed!'
                      : 'No items in this shopping list yet.'}
                  </ThemedText>
                )}
              </View>

              {/* Scanner integration: Trisheka */}
              <Pressable
                disabled
                accessibilityRole="button"
                accessibilityState={{ disabled: true }}
                style={[
                  styles.scanButton,
                  styles.disabled,
                ]}
              >
                <ThemedText style={styles.scanButtonText}>
                  Scan Product
                </ThemedText>
              </Pressable>

              {/* Completed products */}
              <View style={styles.section}>
                <ThemedText type="smallBold">
                  Completed ({completed.length})
                </ThemedText>

                {completed.length > 0 ? (
                  completed.map(renderItem)
                ) : (
                  <ThemedText themeColor="textSecondary">
                    No completed items yet.
                  </ThemedText>
                )}
              </View>
            </>
          )}

          {/* Leave mode without resetting completion statuses. */}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.replace('/products/shopping-list')
            }
            style={[
              styles.exitButton,
              { borderColor: theme.textSecondary },
            ]}
          >
            <ThemedText type="smallBold">
              Exit Shopping Mode
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  badgeText: {
    color: '#23865c',
    fontWeight: '600',
    fontSize: 12,
  },
  progressCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  progressTrack: {
    height: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#23865c',
  },
  section: {
    gap: Spacing.two,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#fff',
    fontWeight: '700',
  },
  itemInformation: {
    flex: 1,
    gap: Spacing.half,
  },
  completedText: {
    textDecorationLine: 'line-through',
    opacity: 0.65,
  },
  scanButton: {
    padding: Spacing.three,
    alignItems: 'center',
    borderRadius: Spacing.two,
    backgroundColor: '#3c87f7',
  },
  scanButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  exitButton: {
    borderWidth: 1,
    padding: Spacing.three,
    alignItems: 'center',
    borderRadius: Spacing.two,
  },
  message: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
});
