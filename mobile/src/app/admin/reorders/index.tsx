import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listStores, type Store } from "@/api/inventory";
import {
  describeSummary,
  getMyOrderItems,
  getMyOrderRequests,
  getReorderCatalog,
  getReorderLines,
  getStoreOrderRequests,
  getMessages,
  markMessagesRead,
  type BuyerItem,
  type OrderRequestListEntry,
  type ReorderCatalogProduct,
  type ReorderCounts,
  type ReorderLine,
} from "@/api/reorders";
import { PRODUCT_CATEGORIES, fitLabel, type ProductFit } from "@/api/products";
import { useAuth } from "@/auth/AuthContext";
import { useNotifications } from "@/components/notification-banner";
import { StorePicker } from "@/components/store-picker";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Brand, MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type View_ = "product" | "request";

// Status labels and colors, for managers' products and buyers' items
// Status colors come from the theme, so they're brighter in dark mode
type Tone = "danger" | "success";
const MANAGER_STATUS: Record<string, { label: string; tone?: Tone }> = {
  open: { label: "Needs reorder", tone: "danger" },
  requested: { label: "Requested" },
  ordered: { label: "Ordered", tone: "success" },
  unavailable: { label: "Unavailable", tone: "danger" },
};
const BUYER_STATUS: Record<string, { label: string; tone?: Tone }> = {
  pending: { label: "Pending", tone: "danger" },
  ordered: { label: "Ordered", tone: "success" },
  unavailable: { label: "Unavailable" },
  received: { label: "Received", tone: "success" },
};

const buyerItemStatus = (item: BuyerItem) =>
  item.restocked && item.status !== "unavailable" ? "received" : item.status;

// A buyer's items, one row per product per request (its sizes together)
const BUYER_ORDER = ["pending", "unavailable", "ordered", "received"];
type BuyerProduct = {
  key: string;
  requestId: number;
  name: string;
  brand: string | null;
  storeName: string;
  requestedAt: string;
  items: BuyerItem[];
  // Every status its items have, most urgent first
  statuses: string[];
};
function groupBuyerItems(items: BuyerItem[]): BuyerProduct[] {
  const groups = new Map<string, BuyerProduct>();
  for (const item of items) {
    const key = `${item.request_id}-${item.product_id}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        requestId: item.request_id,
        name: item.name,
        brand: item.brand,
        storeName: item.store_name,
        requestedAt: item.requested_at,
        items: [],
        statuses: [],
      });
    groups.get(key)!.items.push(item);
  }
  for (const group of groups.values()) {
    const have = new Set<string>(group.items.map(buyerItemStatus));
    group.statuses = BUYER_ORDER.filter((status) => have.has(status));
  }
  return [...groups.values()];
}

function when(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Manage -> Reorders (/admin/reorders). Managers see their store's low products, each with its
// reorder status, and send them to buyers. Buyers see the order requests sent
// to them. Both can switch between By product and By request.
export default function ReordersScreen() {
  const { profile, hasPermission } = useAuth();
  const isManager = hasPermission("manage_inventory");
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { refresh: refreshUnread } = useNotifications();

  const [view, setView] = useState<View_>(isManager ? "product" : "request");
  // Managers start on the products that need a reorder; buyers on everything
  const defaultFilter = (next: View_) => (isManager && next === "product" ? "open" : "all");
  const [filter, setFilter] = useState(() => defaultFilter(isManager ? "product" : "request"));
  // Managers: a category to narrow the list, the products checked for a
  // reorder (kept while filters change), and each opened product's sizes
  const [category, setCategory] = useState<string | null>(null);
  // The status and category chips fold away so more of the list shows
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sizes, setSizes] = useState<Record<number, ReorderLine[] | "error">>({});
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  // Managers pick one of their stores
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  // Unread per store, shown in the store dropdown as "(3 new)"
  const [unreadByStore, setUnreadByStore] = useState<Record<string, number>>({});
  // A banner can open a particular store: /admin/reorders?storeId=2
  const params = useLocalSearchParams<{ storeId?: string }>();
  const askedStore = params.storeId ? Number(params.storeId) : null;
  const store = stores.find((s) => s.store_id === storeId);

  const [products, setProducts] = useState<ReorderCatalogProduct[]>([]);
  const [counts, setCounts] = useState<(ReorderCounts & { all: number }) | null>(null);
  const [requests, setRequests] = useState<OrderRequestListEntry[]>([]);
  const [items, setItems] = useState<BuyerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile || !isManager) return;
    const everyStore = profile.permissions.includes("manage_all_stores");
    Promise.all([listStores(), getMessages().catch(() => null)])
      .then(([all, notifications]) => {
        const mine = everyStore ? all : all.filter((s) => profile.store_ids.includes(s.store_id));
        const unreadAt = notifications?.unread_by_store ?? {};
        setStores(mine);
        setUnreadByStore(unreadAt);
        // Start on the store the banner pointed to, else one with something new, else the first
        const has = (id: number | null) => id !== null && mine.some((s) => s.store_id === id);
        const withNews = mine.find((s) => (unreadAt[s.store_id] ?? 0) > 0)?.store_id ?? null;
        setStoreId((previous) =>
          has(askedStore) ? askedStore : has(previous) ? previous : withNews ?? mine[0]?.store_id ?? null,
        );
      })
      .catch(() => setError("Could not reach the backend. Is it running?"));
  }, [profile, isManager, askedStore]);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (isManager) {
        if (storeId === null) return;
        if (view === "product") {
          const [result, storeRequests] = await Promise.all([
            getReorderCatalog(storeId),
            getStoreOrderRequests(storeId),
          ]);
          setProducts(result.products);
          setCounts(result.counts);
          setRequests(storeRequests);
          // Opened products show fresh sizes next time
          setSizes({});
        } else {
          setRequests(await getStoreOrderRequests(storeId));
        }
        // Seeing the list counts as reading this store's notifications
        markMessagesRead({ store_id: storeId }).then(() => {
          refreshUnread();
          setUnreadByStore((previous) => ({ ...previous, [storeId]: 0 }));
        });
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
  }, [isManager, storeId, view, refreshUnread]);

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
    setFilter(defaultFilter(next));
    setExpanded(null);
    setLoading(true);
  };

  const openRequest = (requestId: number) =>
    router.push({ pathname: "/admin/reorders/[id]", params: { id: String(requestId) } });

  // Send the checked products to the reorder screen
  const openReorder = () =>
    store &&
    selected.size > 0 &&
    router.push({
      pathname: "/admin/reorders/send",
      params: {
        storeId: String(store.store_id),
        storeName: store.name,
        productIds: [...selected].join(","),
      },
    });

  const toggleSelected = (productId: number) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  // Opening a product shows each of its sizes; loaded the first time
  const toggleOpen = (productId: number) => {
    setExpanded((was) => (was === productId ? null : productId));
    if (storeId !== null && sizes[productId] === undefined) {
      getReorderLines(storeId, [productId])
        .then((rows) => setSizes((previous) => ({ ...previous, [productId]: rows })))
        .catch(() => setSizes((previous) => ({ ...previous, [productId]: "error" })));
    }
  };

  const query = search.trim().toLowerCase();
  const matches = (name: string, brand: string | null) =>
    !query || name.toLowerCase().includes(query) || (brand ?? "").toLowerCase().includes(query);

  const buyerProducts = groupBuyerItems(items);

  // The filter chips for the current view
  let chips: { key: string; label: string }[] = [];
  if (view === "product" && isManager) {
    chips = [
      ...(["open", "requested", "ordered", "unavailable"] as const).map((key) => ({
        key,
        label: `${MANAGER_STATUS[key].label} (${counts?.[key] ?? 0})`,
      })),
      { key: "all", label: `All products (${counts?.all ?? products.length})` },
    ];
  } else if (view === "product") {
    const count = (key: string) => buyerProducts.filter((p) => p.statuses.includes(key)).length;
    chips = [
      { key: "all", label: `All (${buyerProducts.length})` },
      ...["pending", "ordered", "unavailable"].map((key) => ({
        key,
        label: `${BUYER_STATUS[key].label} (${count(key)})`,
      })),
    ];
  }

  // A product shows under every status any of its sizes has
  const shownProducts = products.filter(
    (p) =>
      (filter === "all" || p.statuses.includes(filter as ReorderCatalogProduct["statuses"][number])) &&
      (category === null || p.category === category) &&
      matches(p.name, p.brand),
  );
  // Only categories the store sells, so there are no empty filters
  const categories = PRODUCT_CATEGORIES.filter((c) => products.some((p) => p.category === c.value));
  const allShownSelected = shownProducts.length > 0 && shownProducts.every((p) => selected.has(p.product_id));
  const shownItems = buyerProducts.filter(
    (p) => (filter === "all" || p.statuses.includes(filter)) && matches(p.name, p.brand),
  );
  const needsReassignment = requests.filter((request) => request.needs_reassignment).length;

  const header = (
    <View style={styles.header}>
      {isManager && (
        <StorePicker
          stores={stores}
          storeId={storeId}
          unreadByStore={unreadByStore}
          onChange={(id) => {
            setStoreId(id);
            setSelected(new Set());
            setLoading(true);
          }}
        />
      )}
      {isManager && needsReassignment > 0 && (
        <AppButton label={`${needsReassignment} request(s) need buyer reassignment`} onPress={() => switchView("request")} />
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
          <View style={styles.searchRow}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search products"
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false}
              clearButtonMode="while-editing"
              style={[styles.search, styles.flex, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            {/* Folded, the button names the filter in use, e.g. "Needs reorder · Shoes" */}
            <Pressable
              onPress={() => setFiltersOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: filtersOpen }}
              style={({ pressed }) => [
                styles.filterButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold" numberOfLines={1}>
                {filtersOpen
                  ? "Filters ▴"
                  : `${[
                      chips.find((chip) => chip.key === filter)?.label.replace(/ \(\d+\)$/, ""),
                      categories.find((c) => c.value === category)?.label,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Filters"} ▾`}
              </ThemedText>
            </Pressable>
          </View>
          {filtersOpen && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {chips.map((chip) => (
              <ChoiceChip
                key={chip.key}
                label={chip.label}
                selected={filter === chip.key}
                onPress={() => setFilter(chip.key)}
              />
            ))}
          </ScrollView>
          )}
          {filtersOpen && isManager && categories.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <ChoiceChip label="All types" selected={category === null} onPress={() => setCategory(null)} />
              {categories.map((c) => (
                <ChoiceChip
                  key={c.value}
                  label={c.label}
                  selected={category === c.value}
                  onPress={() => setCategory(c.value)}
                />
              ))}
            </ScrollView>
          )}
          {/* Select all picks what's showing: tap Shoes, then Select all */}
          {isManager && shownProducts.length > 0 && (
            <View style={styles.selectRow}>
              <Pressable
                onPress={() =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    for (const p of shownProducts) {
                      if (allShownSelected) next.delete(p.product_id);
                      else next.add(p.product_id);
                    }
                    return next;
                  })
                }
                hitSlop={8}
              >
                <ThemedText type="linkPrimary">
                  {allShownSelected ? "Unselect these" : `Select all (${shownProducts.length})`}
                </ThemedText>
              </Pressable>
              {selected.size > 0 && (
                <Pressable onPress={() => setSelected(new Set())} hitSlop={8}>
                  <ThemedText type="linkPrimary">{`Clear (${selected.size})`}</ThemedText>
                </Pressable>
              )}
            </View>
          )}
        </>
      )}

      {loading && <ActivityIndicator />}
      {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
    </View>
  );

  const listStyle = [styles.list, { paddingBottom: insets.bottom + Spacing.three }];
  const empty = (text: string) => (!loading && !error ? <ThemedText themeColor="textSecondary">{text}</ThemedText> : null);

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={isManager ? "Reorders" : "Order requests"}
        eyebrow="Management"
        subtitle={isManager ? store?.name : "Order requests sent to you"}
        fallback="/manage"
        backLabel="Management"
      />
      <View style={styles.body}>
        {/* Stays in place; only the list below scrolls */}
        {header}
        {view === "product" && isManager && (
          <FlatList
            data={shownProducts}
            keyExtractor={(p) => String(p.product_id)}
            style={styles.edgeToEdge}
            contentContainerStyle={[
              listStyle,
              styles.edgePadding,
              selected.size > 0 && { paddingBottom: insets.bottom + Spacing.six },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshing={refreshing}
            onRefresh={refresh}
            renderItem={({ item }) => (
              <ManagerProductRow
                product={item}
                checked={selected.has(item.product_id)}
                onCheck={() => toggleSelected(item.product_id)}
                open={expanded === item.product_id}
                onPress={() => toggleOpen(item.product_id)}
                sizes={sizes[item.product_id]}
              />
            )}
            ListEmptyComponent={empty(
              query || category
                ? "No products match."
                : filter === "open"
                  ? "Nothing needs a reorder. Pick All products to order ahead."
                  : "No products here.",
            )}
          />
        )}
        {/* The checked products go to the reorder screen together */}
        {view === "product" && isManager && selected.size > 0 && (
          <View style={[styles.bottomBar, { bottom: Math.max(insets.bottom - Spacing.four, Spacing.one) }]}>
            <AppButton
              label={`Reorder ${selected.size} product${selected.size === 1 ? "" : "s"}`}
              onPress={openReorder}
            />
          </View>
        )}

        {view === "product" && !isManager && (
          <FlatList
            data={shownItems}
            keyExtractor={(group) => group.key}
            style={styles.edgeToEdge}
            contentContainerStyle={[listStyle, styles.edgePadding]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshing={refreshing}
            onRefresh={refresh}
            renderItem={({ item }) => <BuyerItemRow product={item} onPress={() => openRequest(item.requestId)} />}
            ListEmptyComponent={empty(query || filter !== "all" ? "No products match." : "Nothing to order right now.")}
          />
        )}

        {view === "request" && (
          <FlatList
            data={requests}
            keyExtractor={(request) => String(request.request_id)}
            style={styles.edgeToEdge}
            contentContainerStyle={[listStyle, styles.edgePadding]}
            refreshing={refreshing}
            onRefresh={refresh}
            renderItem={({ item }) => (
              <RequestRow request={item} forManager={isManager} onPress={() => openRequest(item.request_id)} />
            )}
            ListEmptyComponent={empty("No open order requests.")}
          />
        )}
      </View>
    </ThemedView>
  );
}

function StatusChip({ status }: { status: { label: string; tone?: Tone } }) {
  const theme = useTheme();
  return (
    <ThemedText type="smallBold" style={status.tone ? { color: theme[status.tone] } : undefined}>
      {status.label}
    </ThemedText>
  );
}

function ManagerProductRow({
  product,
  checked,
  onCheck,
  open,
  onPress,
  sizes,
}: {
  product: ReorderCatalogProduct;
  checked: boolean;
  onCheck: () => void;
  open: boolean;
  onPress: () => void;
  sizes: ReorderLine[] | "error" | undefined;
}) {
  const theme = useTheme();
  const hasOptions = product.variant_count > 1;
  const stockLine = hasOptions
    ? `${product.low_count} of ${product.variant_count} low · ${product.quantity} in stock`
    : `${product.quantity} left · low at ${product.low_stock_threshold}`;
  return (
    <ThemedView
      type="card"
      style={[styles.row, { borderColor: checked ? theme.link : theme.border }]}
    >
      <View style={styles.rowTop}>
        <Pressable
          onPress={onCheck}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={`Select ${product.name}`}
          style={[
            styles.checkbox,
            { borderColor: checked ? theme.link : theme.textSecondary },
            checked && { backgroundColor: Brand.navy },
          ]}
        >
          {checked && <ThemedText style={styles.checkmark}>✓</ThemedText>}
        </Pressable>
        <Pressable onPress={onPress} style={({ pressed }) => [styles.flex, pressed && styles.pressed]}>
          <ThemedText type="smallBold">{product.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[fitLabel(product.fit as ProductFit | null), stockLine].filter(Boolean).join(" · ")}
          </ThemedText>
        </Pressable>
        {product.status && <StatusChip status={MANAGER_STATUS[product.status]} />}
      </View>
      {open && (
        <View style={styles.details}>
          <ThemedText type="small" themeColor="textSecondary">
            {`Buyer: ${product.buyer_email ?? "none assigned"}`}
          </ThemedText>
          {sizes === undefined && <ActivityIndicator />}
          {sizes === "error" && (
            <ThemedText type="small" themeColor="textSecondary">Could not load the sizes.</ThemedText>
          )}
          {Array.isArray(sizes) && <SizeStock lines={sizes} />}
        </View>
      )}
    </ThemedView>
  );
}

// A product's sizes under each color: "Size 9   0 in stock   Needs reorder"
function SizeStock({ lines }: { lines: ReorderLine[] }) {
  const colors = [...new Set(lines.map((line) => line.color))];
  if (lines.length === 1 && !lines[0].color && !lines[0].size) return null;
  return (
    <View style={styles.sizeList}>
      {colors.map((color) => (
        <View key={color ?? "none"} style={styles.sizeGroup}>
          {color && <ThemedText type="smallBold">{color}</ThemedText>}
          {lines
            .filter((line) => line.color === color)
            .map((line) => (
              <View key={line.variant_id} style={styles.sizeRow}>
                <ThemedText type="small" style={styles.sizeName} numberOfLines={1}>
                  {line.size ? `Size ${line.size}` : line.color ?? ""}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {`${line.quantity} in stock`}
                </ThemedText>
                <View style={styles.sizeStatus}>
                  {line.status ? (
                    <StatusChip status={MANAGER_STATUS[line.status]} />
                  ) : null}
                </View>
              </View>
            ))}
        </View>
      ))}
    </View>
  );
}

function BuyerItemRow({ product, onPress }: { product: BuyerProduct; onPress: () => void }) {
  const theme = useTheme();
  const units = product.items.reduce((sum, item) => sum + item.quantity, 0);
  const sized = product.items.some((item) => item.color || item.size);
  const what = sized
    ? `${product.items.length} item${product.items.length === 1 ? "" : "s"} · ${units} units`
    : `${units} units`;
  const reasons = [
    ...new Set(product.items.filter((item) => item.status === "unavailable" && item.reason).map((item) => item.reason)),
  ];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="card" style={[styles.row, { borderColor: theme.border }]}>
        <View style={styles.rowTop}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{product.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {`${what} · ${product.storeName} · ${when(product.requestedAt)}`}
            </ThemedText>
          </View>
          {product.statuses[0] && <StatusChip status={BUYER_STATUS[product.statuses[0]]} />}
        </View>
        {reasons.map((reason) => (
          <ThemedText key={reason} type="small" themeColor="textSecondary">
            {`Reason: ${reason}`}
          </ThemedText>
        ))}
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
  const theme = useTheme();
  const who = forManager ? `To ${request.buyer_email ?? "a buyer"}` : `From ${request.sent_by_email ?? "a manager"}`;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="card" style={[styles.row, { borderColor: theme.border }]}>
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
        {forManager && request.needs_reassignment && (
          <ThemedText type="smallBold" style={{ color: theme.danger }}>Needs reassignment</ThemedText>
        )}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Lists reach the screen edges so the scroll bar sits at the edge, while
  // their content keeps the page's side margins
  edgeToEdge: {
    marginHorizontal: -Spacing.four,
  },
  edgePadding: {
    paddingHorizontal: Spacing.four,
  },
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
  },
  header: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  filterButton: {
    maxWidth: "50%",
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
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
    borderRadius: Radius.medium,
    borderWidth: 1,
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
  selectRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: {
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "700",
  },
  sizeList: {
    gap: Spacing.two,
  },
  sizeGroup: {
    gap: Spacing.half,
  },
  sizeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  // Name and stock take only what they need, so the status fits on one line
  sizeName: {
    width: 88,
  },
  sizeStatus: {
    flex: 1,
    alignItems: "flex-end",
  },
  // Floats over the bottom of the list; only the button shows
  bottomBar: {
    position: "absolute",
    left: Spacing.four,
    right: Spacing.four,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Brand.red,
  },
  pressed: {
    opacity: 0.6,
  },
});
