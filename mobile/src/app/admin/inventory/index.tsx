import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getStoreInventory,
  listStores,
  type InventoryStatus,
  type Store,
  type StoreStockEntry,
} from "@/api/inventory";
import { productImageUrl } from "@/api/products";
import { useAuth } from "@/auth/AuthContext";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const TABS: { status: InventoryStatus; label: string }[] = [
  { status: "active", label: "Active" },
  { status: "pending", label: "Pending" },
  { status: "discontinued", label: "Discontinued" },
];

export default function InventoryScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [choosingStore, setChoosingStore] = useState(false);
  const [status, setStatus] = useState<InventoryStatus>("active");
  const [items, setItems] = useState<StoreStockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const store = stores.find((item) => item.store_id === storeId);

  // App admins can pick any store; everyone else only the stores they're assigned to
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    const allStores = profile.permissions.includes("manage_all_stores");
    listStores()
      .then((all) => {
        if (cancelled) return;
        const mine = allStores ? all : all.filter((s) => profile.store_ids.includes(s.store_id));
        setStores(mine);
        setStoreId((previous) =>
          mine.some((s) => s.store_id === previous) ? previous : mine[0]?.store_id ?? null,
        );
        if (mine.length === 0) setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not reach the backend. Is it running?");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  // The selected store's entries for the selected tab
  const loadInventory = useCallback(async () => {
    if (storeId === null) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await getStoreInventory(storeId, status));
    } catch (problem) {
      setItems([]);
      setError(problem instanceof Error ? problem.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }, [storeId, status]);

  // Reloads when the screen comes back into view (after an edit) or the store/tab changes
  useFocusEffect(
    useCallback(() => {
      loadInventory();
    }, [loadInventory]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await loadInventory();
    setRefreshing(false);
  };

  const query = search.trim().toLowerCase();
  const visibleItems = items.filter(
    (item) =>
      item.product_name.toLowerCase().includes(query) ||
      (item.brand ?? "").toLowerCase().includes(query),
  );

  // Opens the edit screen with what this row already shows, so it opens instantly
  const openItem = (item: StoreStockEntry) =>
    router.push({
      pathname: "/admin/inventory/[productId]",
      params: {
        productId: String(item.product_id),
        storeId: String(item.store_id),
        storeName: store?.name ?? "",
        name: item.product_name,
        image: productImageUrl(item) ?? "",
        price: item.price === null ? "" : item.price.toFixed(2),
        quantity: String(item.quantity),
        status: item.status,
      },
    });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ThemedView style={styles.topBar}>
          <Pressable
            onPress={() => router.dismissTo("/")}
            hitSlop={12}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <ThemedText type="linkPrimary">‹ User view</ThemedText>
          </Pressable>
        </ThemedView>

        <ThemedText type="subtitle">Inventory</ThemedText>

        {store ? (
          <ThemedView type="backgroundElement" style={styles.storeBox}>
            <ThemedText type="small" themeColor="textSecondary">
              Store
            </ThemedText>
            <ThemedText type="smallBold">{store.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {store.address}
            </ThemedText>
            {stores.length > 1 && (
              <Pressable
                onPress={() => setChoosingStore((open) => !open)}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <ThemedText type="linkPrimary">
                  {choosingStore ? "Close store list" : "Change store"}
                </ThemedText>
              </Pressable>
            )}
            {choosingStore &&
              stores.map((item) => (
                <Pressable
                  key={item.store_id}
                  onPress={() => {
                    setStoreId(item.store_id);
                    setChoosingStore(false);
                  }}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <ThemedText type={item.store_id === storeId ? "smallBold" : "small"}>
                    {`${item.store_id === storeId ? "✓ " : ""}${item.name}`}
                  </ThemedText>
                </Pressable>
              ))}
          </ThemedView>
        ) : (
          !loading &&
          !error && (
            <ThemedText themeColor="textSecondary">
              You aren't assigned to any stores yet.
            </ThemedText>
          )
        )}

        <View style={styles.tabs}>
          {TABS.map((tab) => (
            <Pressable
              key={tab.status}
              onPress={() => setStatus(tab.status)}
              style={({ pressed }) => [styles.tabPress, pressed && styles.pressed]}
            >
              <ThemedView
                type={tab.status === status ? "backgroundSelected" : "backgroundElement"}
                style={styles.tab}
              >
                <ThemedText type={tab.status === status ? "smallBold" : "small"}>
                  {tab.label}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search this store's products"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
        {loading && items.length === 0 && <ActivityIndicator />}

        <FlatList
          data={visibleItems}
          keyExtractor={(item) => `${item.store_id}-${item.product_id}`}
          refreshing={refreshing}
          onRefresh={refresh}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.three }]}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <StockRow item={item} onPress={() => openItem(item)} />}
          ListEmptyComponent={
            !loading && !error && store ? (
              <ThemedText themeColor="textSecondary">
                {query
                  ? `No products match "${search.trim()}".`
                  : status === "pending"
                    ? "Nothing waiting for approval."
                    : `No ${status} products at this store.`}
              </ThemedText>
            ) : null
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function StockRow({ item, onPress }: { item: StoreStockEntry; onPress: () => void }) {
  const price = item.price === null ? "No price" : `$${item.price.toFixed(2)}`;
  const stock =
    item.status === "pending" ? "Needs approval" : item.quantity > 0 ? `${item.quantity} in stock` : "Out of stock";
  const imageUrl = productImageUrl(item);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.row}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={[styles.thumbnail, styles.whiteBackground]}
            contentFit="contain"
          />
        ) : (
          <ThemedView type="backgroundSelected" style={styles.thumbnail} />
        )}
        <ThemedView type="backgroundElement" style={styles.rowText}>
          <ThemedText type="smallBold">{item.product_name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[item.brand, `ID ${item.product_id}`].filter(Boolean).join(" · ")}
          </ThemedText>
        </ThemedView>
        <ThemedView type="backgroundElement" style={styles.rowRight}>
          <ThemedText type="smallBold">{price}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {stock}
          </ThemedText>
        </ThemedView>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    flexDirection: "row",
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Platform.OS === "web" ? Spacing.six + Spacing.four : Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
  },
  storeBox: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
  },
  tabs: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  tabPress: {
    flex: 1,
  },
  tab: {
    alignItems: "center",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  search: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  list: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
  },
  // Product photos have see-through backgrounds, so they sit on white in both light and dark mode
  whiteBackground: {
    backgroundColor: "#ffffff",
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.6,
  },
});