import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { listStores, type Store } from "@/api/inventory";
import {
  describeSummary,
  getMyOrderItems,
  getMyOrderRequests,
  getReorders,
  getStoreOrderRequests,
  markMessagesRead,
  type BuyerItem,
  type OrderRequestListEntry,
  type ReorderCounts,
  type ReorderProduct,
} from "@/api/reorders";
import { useAuth } from "@/auth/AuthContext";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type View_ = "product" | "request";

// Status labels and colors, for managers' products and buyers' items
const RED = "#E5484D";
const GREEN = "#30A46C";
const MANAGER_STATUS: Record<string, { label: string; color?: string }> = {
  open: { label: "Needs reorder", color: RED },
  requested: { label: "Requested" },
  ordered: { label: "Ordered", color: GREEN },
  unavailable: { label: "Unavailable", color: RED },
};
const BUYER_STATUS: Record<string, { label: string; color?: string }> = {
  pending: { label: "Pending", color: RED },
  ordered: { label: "Ordered", color: GREEN },
  unavailable: { label: "Unavailable" },
  received: { label: "Received", color: GREEN },
};

const buyerItemStatus = (item: BuyerItem) =>
  item.restocked && item.status !== "unavailable" ? "received" : item.status;

function when(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Account -> Reorders. Managers see their store's low products, each with its
// reorder status, and send them to buyers. Buyers see the order requests sent
// to them. Both can switch between By product and By request.
export default function ReordersScreen() {
  const { profile, hasPermission } = useAuth();
  const isManager = hasPermission("manage_inventory");
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [view, setView] = useState<View_>(isManager ? "product" : "request");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  // Managers pick one of their stores
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [choosingStore, setChoosingStore] = useState(false);
  const store = stores.find((s) => s.store_id === storeId);

  const [products, setProducts] = useState<ReorderProduct[]>([]);
  const [counts, setCounts] = useState<ReorderCounts | null>(null);
  const [requests, setRequests] = useState<OrderRequestListEntry[]>([]);
  const [items, setItems] = useState<BuyerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile || !isManager) return;
    const everyStore = profile.permissions.includes("manage_all_stores");
    listStores()
      .then((all) => {
        const mine = everyStore ? all : all.filter((s) => profile.store_ids.includes(s.store_id));
        setStores(mine);
        setStoreId((previous) => (mine.some((s) => s.store_id === previous) ? previous : mine[0]?.store_id ?? null));
      })
      .catch(() => setError("Could not reach the backend. Is it running?"));
  }, [profile, isManager]);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (isManager) {
        if (storeId === null) return;
        if (view === "product") {
          const result = await getReorders(storeId);
          setProducts(result.products);
          setCounts(result.counts);
        } else {
          setRequests(await getStoreOrderRequests(storeId));
        }
        // Seeing the list counts as reading this store's notifications
        markMessagesRead({ store_id: storeId });
      } else if (view === "request") {
        setRequests(await getMyOrderRequests());
      } else {
        setItems(await getMyOrderItems());
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not load reorders.");
    } finally {
      setLoading(false);
    }
  }, [isManager, storeId, view]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const switchView = (next: View_) => {
    setView(next);
    setFilter("all");
    setExpanded(null);
    setLoading(true);
  };

  const openRequest = (requestId: number) =>
    router.push({ pathname: "/account/request/[id]", params: { id: String(requestId) } });

  const openReorder = () =>
    store &&
    router.push({
      pathname: "/admin/inventory/reorder",
      params: { storeId: String(store.store_id), storeName: store.name },
    });

  const query = search.trim().toLowerCase();
  const matches = (name: string, brand: string | null) =>
    !query || name.toLowerCase().includes(query) || (brand ?? "").toLowerCase().includes(query);

  // The filter chips for the current view
  let chips: { key: string; label: string }[] = [];
  if (view === "product" && isManager) {
    chips = [
      { key: "all", label: `All (${products.length})` },
      ...(["open", "requested", "ordered", "unavailable"] as const).map((key) => ({
        key,
        label: `${MANAGER_STATUS[key].label} (${counts?.[key] ?? 0})`,
      })),
    ];
  } else if (view === "product") {
    const count = (key: string) => items.filter((item) => buyerItemStatus(item) === key).length;
    chips = [
      { key: "all", label: `All (${items.length})` },
      ...["pending", "ordered", "unavailable"].map((key) => ({
        key,
        label: `${BUYER_STATUS[key].label} (${count(key)})`,
      })),
    ];
  }

  const shownProducts = products.filter(
    (p) => (filter === "all" || p.status === filter) && matches(p.name, p.brand),
  );
  const shownItems = items.filter(
    (item) => (filter === "all" || buyerItemStatus(item) === filter) && matches(item.name, item.brand),
  );
  const waiting = counts ? counts.open + counts.unavailable : 0;

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/account"))}
        hitSlop={12}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <ThemedText type="linkPrimary">‹ Account</ThemedText>
      </Pressable>
      <ThemedText type="subtitle">Reorders</ThemedText>

      {isManager && stores.length > 1 && (
        <ThemedView type="backgroundElement" style={styles.dropdown}>
          <Pressable onPress={() => setChoosingStore((open) => !open)}>
            <ThemedText type="small">{`${store?.name ?? "Choose a store"}  ${choosingStore ? "▴" : "▾"}`}</ThemedText>
          </Pressable>
          {choosingStore &&
            stores.map((s) => (
              <Pressable
                key={s.store_id}
                onPress={() => {
                  setStoreId(s.store_id);
                  setChoosingStore(false);
                  setLoading(true);
                }}
              >
                <ThemedText type={s.store_id === storeId ? "smallBold" : "small"}>
                  {`${s.store_id === storeId ? "✓ " : ""}${s.name}`}
                </ThemedText>
              </Pressable>
            ))}
        </ThemedView>
      )}
      {isManager && stores.length === 1 && store && (
        <ThemedText type="small" themeColor="textSecondary">
          {store.name}
        </ThemedText>
      )}

      {isManager && store && (
        <Pressable onPress={openReorder} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="backgroundSelected" style={styles.reorderButton}>
            <ThemedText type="smallBold">
              {waiting > 0 ? `Reorder (${waiting} waiting)` : "Reorder"}
            </ThemedText>
          </ThemedView>
        </Pressable>
      )}

      {/* By product | By request */}
      <ThemedView type="backgroundElement" style={styles.segments}>
        {(["product", "request"] as const).map((key) => (
          <Pressable key={key} onPress={() => switchView(key)} style={styles.segmentPress}>
            <ThemedView type={view === key ? "backgroundSelected" : "backgroundElement"} style={styles.segment}>
              <ThemedText type={view === key ? "smallBold" : "small"}>
                {key === "product" ? "By product" : "By request"}
              </ThemedText>
            </ThemedView>
          </Pressable>
        ))}
      </ThemedView>

      {view === "product" && (
        <>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products"
            placeholderTextColor={theme.textSecondary}
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {chips.map((chip) => (
              <Pressable key={chip.key} onPress={() => setFilter(chip.key)}>
                <ThemedView
                  type={filter === chip.key ? "backgroundSelected" : "backgroundElement"}
                  style={styles.chip}
                >
                  <ThemedText type={filter === chip.key ? "smallBold" : "small"}>{chip.label}</ThemedText>
                </ThemedView>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      {loading && <ActivityIndicator />}
      {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
    </View>
  );

  const listStyle = [styles.list, { paddingBottom: insets.bottom + BottomTabInset + Spacing.three }];
  const empty = (text: string) => (!loading && !error ? <ThemedText themeColor="textSecondary">{text}</ThemedText> : null);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        {view === "product" && isManager && (
          <FlatList
            data={shownProducts}
            keyExtractor={(p) => String(p.alert_id)}
            ListHeaderComponent={header}
            contentContainerStyle={listStyle}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshing={refreshing}
            onRefresh={refresh}
            renderItem={({ item }) => (
              <ManagerProductRow
                product={item}
                open={expanded === item.alert_id}
                onPress={() => setExpanded((was) => (was === item.alert_id ? null : item.alert_id))}
                onOpenRequest={openRequest}
              />
            )}
            ListEmptyComponent={empty(query || filter !== "all" ? "No products match." : "No products are low on stock.")}
          />
        )}

        {view === "product" && !isManager && (
          <FlatList
            data={shownItems}
            keyExtractor={(item) => `${item.request_id}-${item.product_id}`}
            ListHeaderComponent={header}
            contentContainerStyle={listStyle}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshing={refreshing}
            onRefresh={refresh}
            renderItem={({ item }) => <BuyerItemRow item={item} onPress={() => openRequest(item.request_id)} />}
            ListEmptyComponent={empty(query || filter !== "all" ? "No products match." : "Nothing to order right now.")}
          />
        )}

        {view === "request" && (
          <FlatList
            data={requests}
            keyExtractor={(request) => String(request.request_id)}
            ListHeaderComponent={header}
            contentContainerStyle={listStyle}
            refreshing={refreshing}
            onRefresh={refresh}
            renderItem={({ item }) => (
              <RequestRow request={item} forManager={isManager} onPress={() => openRequest(item.request_id)} />
            )}
            ListEmptyComponent={empty("No open order requests.")}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function StatusChip({ status }: { status: { label: string; color?: string } }) {
  return (
    <ThemedText type="smallBold" style={status.color ? { color: status.color } : undefined}>
      {status.label}
    </ThemedText>
  );
}

function ManagerProductRow({
  product,
  open,
  onPress,
  onOpenRequest,
}: {
  product: ReorderProduct;
  open: boolean;
  onPress: () => void;
  onOpenRequest: (requestId: number) => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <View style={styles.rowTop}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{product.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {`${product.quantity} left · low at ${product.low_stock_threshold}`}
            </ThemedText>
          </View>
          <StatusChip status={MANAGER_STATUS[product.status]} />
        </View>
        {product.status === "unavailable" && (
          <ThemedText type="small" style={{ color: RED }}>
            {`Reason: ${product.reason || "none given"}`}
          </ThemedText>
        )}
        {open && (
          <View style={styles.details}>
            <ThemedText type="small" themeColor="textSecondary">
              {`Low since ${when(product.created_at)} · Buyer: ${product.buyer_email ?? "none assigned"}`}
            </ThemedText>
            {product.request_id !== null ? (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  {`Requested ${product.requested_quantity} from ${product.requested_from ?? "a buyer"}${
                    product.requested_at ? ` on ${when(product.requested_at)}` : ""
                  }`}
                </ThemedText>
                {product.updated_at && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {`Buyer updated it ${when(product.updated_at)}`}
                  </ThemedText>
                )}
                <Pressable onPress={() => onOpenRequest(product.request_id!)}>
                  <ThemedText type="linkPrimary">View order request ›</ThemedText>
                </Pressable>
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Not sent to a buyer yet.
              </ThemedText>
            )}
          </View>
        )}
      </ThemedView>
    </Pressable>
  );
}

function BuyerItemRow({ item, onPress }: { item: BuyerItem; onPress: () => void }) {
  const status = buyerItemStatus(item);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <View style={styles.rowTop}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{item.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {`${item.quantity} units · ${item.store_name} · ${when(item.requested_at)}`}
            </ThemedText>
          </View>
          <StatusChip status={BUYER_STATUS[status]} />
        </View>
        {item.status === "unavailable" && item.reason !== "" && (
          <ThemedText type="small" themeColor="textSecondary">
            {`Reason: ${item.reason}`}
          </ThemedText>
        )}
      </ThemedView>
    </Pressable>
  );
}

function RequestRow({
  request,
  forManager,
  onPress,
}: {
  request: OrderRequestListEntry;
  forManager: boolean;
  onPress: () => void;
}) {
  const who = forManager ? `To ${request.buyer_email ?? "a buyer"}` : `From ${request.sent_by_email ?? "a manager"}`;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <View style={styles.rowTop}>
          {request.unread && <View style={styles.unreadDot} />}
          <View style={styles.flex}>
            <ThemedText type="smallBold">
              {`Order Request · ${request.product_count} product${request.product_count === 1 ? "" : "s"}`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {`${request.store_name} · ${who} · ${when(request.created_at)}`}
            </ThemedText>
          </View>
          {request.unread && !forManager && <ThemedText type="smallBold">New</ThemedText>}
        </View>
        <ThemedText type="small">{describeSummary(request.summary)}</ThemedText>
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
    maxWidth: MaxContentWidth,
  },
  header: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  dropdown: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  reorderButton: {
    alignItems: "center",
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  segments: {
    flexDirection: "row",
    padding: Spacing.half,
    borderRadius: Spacing.three,
  },
  segmentPress: {
    flex: 1,
  },
  segment: {
    alignItems: "center",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two + Spacing.half,
  },
  search: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  chips: {
    gap: Spacing.two,
  },
  chip: {
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
    gap: Spacing.half,
  },
  details: {
    gap: Spacing.one,
    paddingTop: Spacing.one,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#3c87f7",
  },
  pressed: {
    opacity: 0.6,
  },
});
