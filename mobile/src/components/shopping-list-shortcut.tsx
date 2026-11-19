import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { listShoppingLists, type ShoppingListSummary } from '@/api/shopping-lists';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// A red left edge, like the stripe under the header, marks it as a shortcut.
// A plain object rather than a StyleSheet style, because on web the card's own
// border color would otherwise win over it.
const RED_EDGE = { borderLeftWidth: 5, borderLeftColor: Brand.red };

// A one-line shortcut on Home to the shopper's list. With an active list it
// goes straight into in-store shopping mode, otherwise to the Shopping List
// screen to make one. Hidden until the lists have loaded, and on errors.
export function ShoppingListShortcut() {
  const router = useRouter();
  const theme = useTheme();
  // undefined while loading, null when there is no active list
  const [active, setActive] = useState<ShoppingListSummary | null | undefined>(undefined);

  // Loads each time Home comes into view, so the count follows check-offs
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listShoppingLists()
        .then((lists) => {
          if (!cancelled) setActive(lists.find((list) => list.is_active) ?? null);
        })
        .catch(() => {
          if (!cancelled) setActive(undefined);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (active === undefined) return null;

  const left = active ? active.total_items - active.completed_items : 0;
  const title = active ? active.name : 'Plan your trip';
  const detail = active
    ? left === 0
      ? 'Everything is checked off'
      : `${left} ${left === 1 ? 'item' : 'items'} left`
    : 'Make a shopping list';
  const action = active ? 'Start shopping' : 'Create list';
  const target = active ? '/products/in-store' : '/products/shopping-list';

  return (
    <Pressable
      onPress={() => router.push(target as Href)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}. ${action}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.card, borderColor: theme.border },
        RED_EDGE,
        pressed && styles.pressed,
      ]}>
      <ThemedText style={styles.icon}>🛒</ThemedText>
      <View style={styles.text}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" themeColor="danger" style={styles.action}>
        {`${action} ›`}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  icon: {
    fontSize: 22,
    lineHeight: 28,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  action: {
  },
  pressed: {
    opacity: 0.7,
  },
});
