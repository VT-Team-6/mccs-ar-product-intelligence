import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getStoreInventory,
  listStoreBuyers,
  updateLowStockSettings,
  type LowStockChange,
  type StoreBuyer,
  type StoreStockEntry,
} from "@/api/inventory";
import { BuyerPicker, type BuyerChoice } from "@/components/buyer-picker";
import { useAuth } from "@/auth/AuthContext";
import { canAccessStore } from "@/auth/store-access";
import { KeyboardDoneBar } from "@/components/keyboard-done-bar";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const WHOLE_NUMBER = /^\d+$/;

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Set the low-stock level and buyer on many products at once:
// filter by category, tick products (or Select all), then apply.
// /admin/inventory/low-stock?storeId=1&storeName=...
export default function LowStockSettingsScreen() {
  const params = useLocalSearchParams<{ storeId: string; storeName?: string }>();
  const storeId = Number(params.storeId);
  const { profile, hasPermission } = useAuth();
  if (!hasPermission("manage_inventory") || !canAccessStore(profile, storeId)) {
    return <Redirect href="/admin/inventory" />;
  }
  return <LowStockSettings storeId={storeId} storeName={params.storeName} />;
}

function LowStockSettings({ storeId, storeName }: { storeId: number; storeName?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [items, setItems] = useState<StoreStockEntry[]>([]);
  const [buyers, setBuyers] = useState<StoreBuyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [choosingCategory, setChoosingCategory] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [level, setLevel] = useState("");
  const [buyer, setBuyer] = useState<BuyerChoice>("keep");
  const [saving, setSaving] = useState(false);
  const [typingLevel, setTypingLevel] = useState(false);
  const levelField = useRef<TextInput>(null);
  const [barShowing, setBarShowing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [stock, storeBuyers] = await Promise.all([
        getStoreInventory(storeId, "active"),
        listStoreBuyers(storeId),
      ]);
      setItems(stock);
      setBuyers(storeBuyers);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not load the products.");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  // Reload when coming back from a product's size levels
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A product's own screen for per-color/size levels
  const openLevels = (item: StoreStockEntry) =>
    router.push({
      pathname: "/admin/inventory/levels",
      params: {
        storeId: String(storeId),
        storeName: storeName ?? "",
        productId: String(item.product_id),
        productName: item.product_name,
        level: String(item.low_stock_threshold ?? 10),
      },
    } as unknown as Href);

  const categories = [...new Set(items.map((item) => item.category).filter((c): c is string => !!c))].sort();
  // The products shown: in the chosen category and matching the search.
  // Select all ticks only these.
  const query = search.trim().toLowerCase();
  const visible = items.filter(
    (item) =>
      (category === null || item.category === category) &&
      (!query ||
        item.product_name.toLowerCase().includes(query) ||
        (item.brand ?? "").toLowerCase().includes(query)),
  );
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.product_id));

  const toggle = (productId: number) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  // Select all ticks every product in the current category; tapping again unticks them
  const toggleAll = () =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const item of visible) {
        if (allVisibleSelected) next.delete(item.product_id);
        else next.add(item.product_id);
      }
      return next;
    });

  const apply = async () => {
    Keyboard.dismiss();
    setError(null);
    setMessage(null);
    const change: LowStockChange = {};
    if (level.trim() !== "") {
      if (!WHOLE_NUMBER.test(level.trim())) {
        setError("The low-stock level must be a whole number, 0 or more.");
        return;
      }
      change.low_stock_threshold = Number(level.trim());
    }
    if (buyer === null) change.clear_buyer = true;
    else if (buyer !== "keep") change.buyer_user_id = buyer;
    if (Object.keys(change).length === 0) {
      setError("Enter a low-stock level or pick a buyer.");
      return;
    }

    setSaving(true);
    try {
      const updated = await updateLowStockSettings(storeId, [...selected], change);
      setMessage(`Updated ${updated} product${updated === 1 ? "" : "s"}.`);
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save the changes.");
    } finally {
      setSaving(false);
    }
  };


  return (
    <ThemedView style={styles.container}>
            <ScreenHeader
        title="Low stock & buyers"
        eyebrow="Inventory"
        subtitle={storeName || undefined}
        fallback="/admin/inventory"
        backLabel="Inventory"
      />
      <View style={styles.body}>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search products"
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        <View style={styles.filters}>
          <ThemedView type="backgroundElement" style={styles.dropdown}>
            <Pressable
              onPress={() => setChoosingCategory((open) => !open)}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <ThemedText type="small">
                {`Category: ${category ? capitalize(category) : "All"}  ${choosingCategory ? "▴" : "▾"}`}
              </ThemedText>
            </Pressable>
            {choosingCategory &&
              [null, ...categories].map((choice) => (
                <Pressable
                  key={choice ?? "all"}
                  onPress={() => {
                    setCategory(choice);
                    setChoosingCategory(false);
                  }}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <ThemedText type={choice === category ? "smallBold" : "small"}>
                    {`${choice === category ? "✓ " : ""}${choice ? capitalize(choice) : "All"}`}
                  </ThemedText>
                </Pressable>
              ))}
          </ThemedView>
          <Pressable onPress={toggleAll} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary">{allVisibleSelected ? "Unselect all" : "Select all"}</ThemedText>
          </Pressable>
        </View>

        {loading && <ActivityIndicator />}

        <FlatList
          data={visible}
          keyExtractor={(item) => String(item.product_id)}
          style={styles.edgeToEdge}
          contentContainerStyle={[styles.list, styles.edgePadding]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isSelected = selected.has(item.product_id);
            // Colors/sizes: the level is per size, and each can have its own
            const hasOptions = (item.variant_count ?? 1) > 1;
            const custom = item.custom_level_count ?? 0;
            const levelText = hasOptions
              ? `Low at ${item.low_stock_threshold ?? 10} per size${custom > 0 ? ` · ${custom} custom` : ""}`
              : `Low at ${item.low_stock_threshold ?? 10}`;
            const lowCount = item.low_variant_count ?? 0;
            const stockText = !item.low_stock
              ? `${item.quantity}`
              : hasOptions
                ? `${item.quantity} · ${lowCount} ${lowCount === 1 ? "size" : "sizes"} low`
                : `${item.quantity} · Low`;
            return (
              <Pressable onPress={() => toggle(item.product_id)} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type={isSelected ? "backgroundSelected" : "backgroundElement"} style={styles.row}>
                  <ThemedText type="small">{isSelected ? "☑" : "☐"}</ThemedText>
                  <ThemedView type={isSelected ? "backgroundSelected" : "backgroundElement"} style={styles.rowText}>
                    <ThemedText type="smallBold">{item.product_name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {`${levelText} · ${item.buyer_email ?? "No buyer"}`}
                    </ThemedText>
                    <ThemedText type="small" themeColor={item.low_stock ? "text" : "textSecondary"}>
                      {stockText}
                    </ThemedText>
                  </ThemedView>
                  {hasOptions && (
                    <Pressable
                      onPress={() => openLevels(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Levels per size for ${item.product_name}`}
                      hitSlop={8}
                      style={({ pressed }) => [styles.sizesLink, pressed && styles.pressed]}
                    >
                      <ThemedText type="linkPrimary">Sizes ›</ThemedText>
                    </Pressable>
                  )}
                </ThemedView>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            !loading ? (
              <ThemedText themeColor="textSecondary">{query ? "No products match." : "No products here."}</ThemedText>
            ) : null
          }
        />

        <ThemedView
          type="backgroundElement"
          style={[styles.panel, { marginBottom: insets.bottom + Spacing.two }]}
        >
          <ThemedText type="smallBold">{`${selected.size} selected`}</ThemedText>
          {items.some((item) => selected.has(item.product_id) && (item.variant_count ?? 1) > 1) && (
            <ThemedText type="small" themeColor="textSecondary">
              For products with sizes the level is per size. Sizes with their own level keep it.
            </ThemedText>
          )}
          <View style={styles.panelRow}>
            <View style={styles.panelField}>
              <ThemedText type="small" themeColor="textSecondary">
                Low stock at
              </ThemedText>
              <TextInput
                value={level}
                onChangeText={setLevel}
                placeholder="Don't change"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                ref={levelField}
                onFocus={() => setTypingLevel(true)}
                onBlur={() => setTypingLevel(false)}
                caretHidden={barShowing}
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
            </View>
            <View style={styles.panelField}>
              <ThemedText type="small" themeColor="textSecondary">
                Buyer
              </ThemedText>
              <BuyerPicker buyers={buyers} value={buyer} onChange={setBuyer} allowKeep />
            </View>
          </View>
          {error && <ThemedText type="small" themeColor="danger" style={styles.error}>{error}</ThemedText>}
          {message && <ThemedText type="small">{message}</ThemedText>}
          <AppButton
            label={`Apply to ${selected.size} selected`}
            onPress={apply}
            disabled={selected.size === 0}
            loading={saving}
          />
        </ThemedView>
      </View>
      <KeyboardDoneBar label={typingLevel ? "Low stock at" : null} value={level} field={typingLevel ? levelField : null}
        onShowingChange={setBarShowing}
      />
    </ThemedView>
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
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  search: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  filters: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  dropdown: {
    flex: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  list: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  sizesLink: {
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  panel: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  panelRow: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "flex-start",
  },
  panelField: {
    flex: 1,
    gap: Spacing.one,
  },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  error: {
  },
  button: {
    alignItems: "center",
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});
