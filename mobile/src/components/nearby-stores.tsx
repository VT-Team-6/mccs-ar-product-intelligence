import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { getProductStock, type ProductStockEntry } from '@/api/inventory';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useStore } from '@/store/StoreContext';
import { distanceToStore, formatMiles } from '@/store/distance';
import { locationProblem } from '@/store/device-location';

type Props = {
  productId: number;
};

type Row = {
  entry: ProductStockEntry;
  miles: number | null;
};

/** Where distances are measured from on this page. */
type Origin = { latitude: number | null; longitude: number | null; name: string };

// Sorts nearest first, keeping stores with no coordinates last in the order the
// API gave (store_id). A null distance must never sort as 0.
function orderRows(entries: ProductStockEntry[], origin: Origin | null): Row[] {
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
export function NearbyStores({ productId }: Props) {
  const {
    store,
    stores,
    setStore,
    openStoreSelector,
    deviceOrigin,
    locating,
    locationRefusal,
    useDeviceLocation,
    clearDeviceOrigin,
  } = useStore();
  const [entries, setEntries] = useState<ProductStockEntry[] | null>(null);
  const [error, setError] = useState(false);
  // A failed store change is worth saying out loud: otherwise the price on the
  // page silently disagrees with the row the shopper just tapped.
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // the active store changes app-wide and the page reprices.
  const pick = async (storeId: number) => {
    const picked = stores.find((item) => item.store_id === storeId);
    if (!picked) return;
    setSaveError(null);
    try {
      await setStore(picked);
    } catch {
      // setStore leaves the old store in place, so say why the price didn't move.
      setSaveError('Could not save your store. Check your connection and try again.');
    }
  };

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

  // The active store is excluded
  const others = entries.filter((entry) => entry.store_id !== store?.store_id);
  if (others.length === 0) return null;

  // A device fix wins over the default which is the store being shopped at
  const origin: Origin | null = deviceOrigin
    ? {
        latitude: deviceOrigin.latitude,
        longitude: deviceOrigin.longitude,
        name: 'your current location',
      }
    : store
      ? { latitude: store.latitude, longitude: store.longitude, name: store.name }
      : null;

  const rows = orderRows(others, origin);

  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedText type="smallBold">Nearby stores</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {origin
          ? `Sorted by distance from ${origin.name}`
          : 'Select a store to see how far each one is.'}
      </ThemedText>

      {deviceOrigin ? (
        <View style={styles.locationActive}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.locationText}>
            Using your current location.
          </ThemedText>
          <Pressable
            onPress={clearDeviceOrigin}
            accessibilityRole="button"
            accessibilityLabel="Stop using your current location"
            hitSlop={8}>
            <ThemedText type="linkPrimary">Stop</ThemedText>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={useDeviceLocation}
          disabled={locating}
          accessibilityRole="button"
          accessibilityState={{ disabled: locating, busy: locating }}
          hitSlop={8}
          style={({ pressed }) => [(pressed || locating) && styles.pressed]}>
          <ThemedText type="linkPrimary">
            {locating ? 'Finding you…' : 'Use my location'}
          </ThemedText>
        </Pressable>
      )}

      {locationRefusal && (
        <ThemedText type="small" style={styles.locationText}>
          {locationProblem(locationRefusal)}
        </ThemedText>
      )}
      {locationRefusal?.status === 'denied' && !locationRefusal.canAskAgain && (
        <Pressable
          onPress={() => Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Open device settings to allow location"
          hitSlop={8}>
          <ThemedText type="linkPrimary">Open settings</ThemedText>
        </Pressable>
      )}

      {!origin && (
        <Pressable
          onPress={() => openStoreSelector()}
          accessibilityRole="button"
          hitSlop={8}>
          <ThemedText type="linkPrimary">
            Select a store to see nearby availability.
          </ThemedText>
        </Pressable>
      )}

      {saveError && (
        <ThemedText type="small" style={styles.error}>
          {saveError}
        </ThemedText>
      )}

      {rows.map(({ entry, miles }) => (
        <Pressable
          key={entry.store_id}
          onPress={() => pick(entry.store_id)}
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
  locationActive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  locationText: { flexShrink: 1 },
  error: { color: '#E5484D' },
  pressed: { opacity: 0.6 },
});
