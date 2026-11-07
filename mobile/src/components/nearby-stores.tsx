import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { getProductStock, type ProductStockEntry } from '@/api/inventory';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { distanceToStore, formatMiles } from '@/store/distance';

type Props = {
  productId: number;
  /** The store the shopper is at now; it is excluded, since the page already says its stock. */
  selectedStore: { store_id: number; latitude: number | null; longitude: number | null } | null;
  selectedStoreName: string | null;
  /** Picking a row changes the active store, so the whole page reprices. */
  onPick: (storeId: number) => void;
  /** Opens the shared store sheet when there is nothing to measure from. */
  onSelectStore: () => void;
};

type Row = {
  entry: ProductStockEntry;
  miles: number | null;
};

// Sorts nearest first, keeping stores with no coordinates last in the order the
// API gave (store_id). A null distance must never sort as 0.
function orderRows(entries: ProductStockEntry[], origin: Props['selectedStore']): Row[] {
  const rows = entries.map((entry) => ({
    entry,
    miles: origin
      ? distanceToStore(
          { latitude: origin.latitude, longitude: origin.longitude },
          { latitude: entry.latitude, longitude: entry.longitude },
        )
      : null,
  }));

  return rows.sort((left, right) => {
    if (left.miles === null && right.miles === null) {
      return left.entry.store_id - right.entry.store_id;
    }
    if (left.miles === null) return 1;
    if (right.miles === null) return -1;
    return left.miles - right.miles;
  });
}

// Other stores that carry this product, nearest first, with their stock.
// Renders nothing when it has nothing useful to say: no other store, or the
// lookup failed. It must never block or clutter the product page.
export function NearbyStores({
  productId,
  selectedStore,
  selectedStoreName,
  onPick,
  onSelectStore,
}: Props) {
  const [entries, setEntries] = useState<ProductStockEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stock = await getProductStock(productId);
        if (cancelled) return;
        setEntries(stock.stores);
        setError(false);
      } catch {
        // Non-fatal: the product page is fully usable without this section.
        if (cancelled) return;
        setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (error) return null;
  if (entries === null) {
    return (
      <ThemedView type="backgroundElement" style={styles.section}>
        <ThemedText type="smallBold">Nearby stores</ThemedText>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </ThemedView>
    );
  }

  const others = entries.filter((entry) => entry.store_id !== selectedStore?.store_id);
  if (others.length === 0) return null;

  const rows = orderRows(others, selectedStore);

  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedText type="smallBold">Nearby stores</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {selectedStore
          ? `Sorted by distance from ${selectedStoreName ?? 'your store'}`
          : 'Select a store to see how far each one is.'}
      </ThemedText>

      {!selectedStore && (
        <Pressable
          onPress={onSelectStore}
          accessibilityRole="button"
          hitSlop={8}>
          <ThemedText type="linkPrimary">
            Select a store to see nearby availability.
          </ThemedText>
        </Pressable>
      )}

      {rows.map(({ entry, miles }) => (
        <Pressable
          key={entry.store_id}
          onPress={() => onPick(entry.store_id)}
          accessibilityRole="button"
          accessibilityLabel={`Shop at ${entry.store_name}`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <ThemedText type="smallBold">{entry.store_name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {entry.address}
            </ThemedText>
          </View>
          <View style={styles.rowRight}>
            {miles !== null && (
              <ThemedText type="small" themeColor="textSecondary">
                {formatMiles(miles)}
              </ThemedText>
            )}
            <ThemedText
              type="small"
              themeColor={entry.in_stock ? 'text' : 'textSecondary'}>
              {entry.in_stock ? `In stock (${entry.quantity})` : 'Out of stock'}
            </ThemedText>
          </View>
        </Pressable>
      ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  center: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  rowText: { flex: 1, gap: Spacing.half },
  rowRight: { alignItems: 'flex-end', gap: Spacing.half },
  pressed: { opacity: 0.6 },
});
