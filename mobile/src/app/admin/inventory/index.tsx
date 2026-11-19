import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  exportStockCsv,
  getStoreInventory,
  listStores,
  type InventoryStatus,
  type Store,
  type StoreStockEntry,
} from "@/api/inventory";
import { productImageUrl } from "@/api/products";
import { useAuth } from "@/auth/AuthContext";
import { StockImportModal } from "@/components/stock-import-modal";
import { StorePicker } from "@/components/store-picker";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Spacing, Radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { pickCsv, saveCsv } from "@/utils/csv-file";

const TABS: { status: InventoryStatus; label: string }[] = [
  { status: "active", label: "Active" },
  { status: "pending", label: "Pending" },
  { status: "discontinued", label: "Discontinued" },
];

export default function InventoryScreen() {
  const { profile, hasPermission } = useAuth();
  const canManageInventory = hasPermission("manage_inventory");
  const canUpdateStock = hasPermission("manage_stock");
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [status, setStatus] = useState<InventoryStatus>("active");
  const [items, setItems] = useState<StoreStockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // The picked end-of-day stock file; the import popup is open while it's set
  const [importCsv, setImportCsv] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

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

  // Downloads the store's stock as a CSV to fill in at closing
  const exportStock = async () => {
    if (!store) return;
    setFileBusy(true);
    setFileError(null);
    try {
      const text = await exportStockCsv(store.store_id);
      const slug = store.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const today = new Date().toISOString().slice(0, 10);
      await saveCsv(`stock-${slug}-${today}.csv`, text);
    } catch (problem) {
      setFileError(problem instanceof Error ? problem.message : "Could not export the stock.");
    } finally {
      setFileBusy(false);
    }
  };

  // Picks the filled-in CSV and opens the preview
  const importStock = async () => {
    setFileError(null);
    try {
      const text = await pickCsv();
      if (text !== null) setImportCsv(text);
    } catch (problem) {
      setFileError(problem instanceof Error ? problem.message : "Could not open the file.");
    }
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
        lowStockAt: String(item.low_stock_threshold ?? 10),
        buyerId: item.buyer_user_id ? String(item.buyer_user_id) : "",
      },
    });

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={canManageInventory ? "Manage inventory" : canUpdateStock ? "Stock counts" : "View inventory"}
        eyebrow={canUpdateStock ? "Management" : "Read only"}
        subtitle={store?.name}
        fallback="/manage"
        backLabel="Management"
      />
      <View style={styles.body}>
        {/* The store's name is in the header; this only switches stores */}
        <StorePicker stores={stores} storeId={storeId} onChange={setStoreId} />
        {!store && !loading && !error && (
          <ThemedText themeColor="textSecondary">You have no store assignments yet.</ThemedText>
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

        {store && status === "active" && canUpdateStock && (
          <View style={styles.fileButtons}>
            <FileButton label="Export stock" onPress={exportStock} disabled={fileBusy} />
            <FileButton label="Import stock" onPress={importStock} disabled={fileBusy} />
          </View>
        )}
        {store && status === "active" && canManageInventory && (
          <View style={styles.fileButtons}>
            <FileButton
              label="Low stock & buyers"
              disabled={false}
              onPress={() =>
                router.push({
                  pathname: "/admin/inventory/low-stock",
                  params: { storeId: String(store.store_id), storeName: store.name },
                })
              }
            />
          </View>
        )}
        {fileError && (
          <ThemedText type="small" themeColor="textSecondary">
            {fileError}
          </ThemedText>
        )}

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
      </View>
      {store && (
        <StockImportModal
          storeId={store.store_id}
          storeName={store.name}
          csv={importCsv}
          onClose={() => setImportCsv(null)}
          onImported={loadInventory}
        />
      )}
    </ThemedView>
  );
}

function FileButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <AppButton label={label} onPress={onPress} disabled={disabled} variant="secondary" size="small" style={styles.fileButton} />
  );
}

function StockRow({ item, onPress }: { item: StoreStockEntry; onPress: () => void }) {
  const theme = useTheme();
  const price = item.price === null ? "No price" : `$${item.price.toFixed(2)}`;
  const stock =
    item.status === "pending"
      ? "Needs approval"
      : `${item.quantity > 0 ? `${item.quantity} in stock` : "Out of stock"}${item.low_stock ? " · Low" : ""}`;
  const imageUrl = productImageUrl(item);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="card" style={[styles.row, { borderColor: theme.border }]}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={[styles.thumbnail, styles.whiteBackground]}
            contentFit="contain"
          />
        ) : (
          <ThemedView type="backgroundSelected" style={styles.thumbnail} />
        )}
        <ThemedView type="card" style={styles.rowText}>
          <ThemedText type="smallBold">{item.product_name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[item.brand, `ID ${item.product_id}`].filter(Boolean).join(" · ")}
          </ThemedText>
        </ThemedView>
        <ThemedView type="card" style={styles.rowRight}>
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
  },
  // The page content under the navy band, centered on wide screens
  body: {
    flex: 1,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
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
  fileButton: {
    flex: 1,
  },
  fileButtons: {
    flexDirection: "row",
    gap: Spacing.two,
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
    borderRadius: Radius.medium,
    borderWidth: 1,
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
