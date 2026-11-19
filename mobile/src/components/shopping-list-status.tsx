import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getActiveListStatus, type ActiveListStatus } from '@/api/shopping-lists';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// One line on the product page saying where this product stands on the
// shopper's active list: still needed, or already checked off (for example
// right after scanning it). Shows nothing when it isn't on the active list.
export function ShoppingListStatus({
  productId,
  refreshKey = 0,
}: {
  productId: number;
  // Change this to load again, e.g. after the product was added to a list
  refreshKey?: number;
}) {
  const theme = useTheme();
  const [status, setStatus] = useState<ActiveListStatus | null>(null);

  // Loads when the page comes into view, so a scan or a check-off made on
  // another screen shows up when coming back here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getActiveListStatus(productId)
        .then((found) => {
          if (!cancelled) setStatus(found);
        })
        // The list line is extra information, so a failure just hides it
        .catch(() => {
          if (!cancelled) setStatus(null);
        });
      return () => {
        cancelled = true;
      };
    }, [productId, refreshKey]),
  );

  if (!status || !status.on_list) return null;

  const done = status.is_completed;
  return (
    <View
      style={[
        styles.row,
        { borderColor: done ? Brand.success : theme.border, backgroundColor: theme.card },
      ]}
      accessibilityRole="text">
      <ThemedText style={[styles.icon, { color: done ? Brand.success : theme.link }]}>
        {done ? '✓' : '☐'}
      </ThemedText>
      <View style={styles.text}>
        <ThemedText type="smallBold" style={done ? { color: Brand.success } : undefined}>
          {done ? 'Checked off your list' : 'On your shopping list'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {done ? `Got it for ${status.list_name}` : `Still needed for ${status.list_name}`}
        </ThemedText>
      </View>
    </View>
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
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
});