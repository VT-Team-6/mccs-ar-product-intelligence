import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";

import {
  approveEntry,
  listStoreBuyers,
  removeEntry,
  updateLowStockSettings,
  updateStock,
  type InventoryStatus,
  type LowStockChange,
  type StoreBuyer,
} from "@/api/inventory";
import { useAuth } from "@/auth/AuthContext";
import { canAccessStore } from "@/auth/store-access";
import { BuyerPicker, type BuyerChoice } from "@/components/buyer-picker";
import { KeyboardDoneBar } from "@/components/keyboard-done-bar";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

// A price like 89 or 89.99: no negatives, at most two decimals
const PRICE = /^\d+(\.\d{1,2})?$/;
const WHOLE_NUMBER = /^\d+$/;

// Edit one product's price, stock and status at one store, e.g.
// /admin/inventory/12?storeId=3. Pending products are approved or declined here.
type StockRouteParams = {
  productId: string;
  storeId: string;
  storeName?: string;
  name?: string;
  image?: string;
  price?: string;
  quantity?: string;
  status?: InventoryStatus;
  lowStockAt?: string;
  buyerId?: string;
};

export default function EditStockScreen() {
  const params = useLocalSearchParams<StockRouteParams>();
  const { profile } = useAuth();
  if (!canAccessStore(profile, Number(params.storeId))) return <Redirect href="/admin/inventory" />;
  return <EditStockForm params={params} />;
}

function EditStockForm({ params }: { params: StockRouteParams }) {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const theme = useTheme();

  const productId = Number(params.productId);
  const storeId = Number(params.storeId);
  const pending = params.status === "pending";
  const canManageInventory = hasPermission("manage_inventory");
  const canEditStock = hasPermission("manage_stock") && (canManageInventory || params.status === "active");

  const [price, setPrice] = useState(params.price ?? "");
  const [quantity, setQuantity] = useState(params.quantity ?? "0");
  const [status, setStatus] = useState<InventoryStatus>(
    params.status === "discontinued" ? "discontinued" : "active",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // The number field being typed in, for the bar above the keyboard
  const [typing, setTyping] = useState<"price" | "quantity" | "lowStock" | null>(null);
  const priceField = useRef<TextInput>(null);
  const [barShowing, setBarShowing] = useState(false);
  const quantityField = useRef<TextInput>(null);
  const lowStockField = useRef<TextInput>(null);
  const [error, setError] = useState<string | null>(null);

  // Low-stock level and buyer: only managers and app admins set these
  const canSetLowStock = canManageInventory && !pending;
  // What's saved right now, so Save only sends the level or buyer when they changed
  const [savedLevel, setSavedLevel] = useState(params.lowStockAt || "10");
  const [savedBuyer, setSavedBuyer] = useState<number | null>(params.buyerId ? Number(params.buyerId) : null);
  const [lowStockAt, setLowStockAt] = useState(savedLevel);
  const [buyer, setBuyer] = useState<BuyerChoice>(savedBuyer);
  const [buyers, setBuyers] = useState<StoreBuyer[]>([]);

  // "Changes saved" fades after a few seconds
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  useEffect(() => {
    if (!canSetLowStock) return;
    listStoreBuyers(storeId).then(setBuyers).catch(() => setBuyers([]));
  }, [canSetLowStock, storeId]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/admin/inventory"));

  // The typed values as numbers, or null (with a message) when one isn't valid
  const readValues = (): { price: number; quantity: number } | null => {
    if (canManageInventory && !PRICE.test(price.trim())) {
      setError("Enter a price like 89 or 89.99.");
      return null;
    }
    if (!WHOLE_NUMBER.test(quantity.trim())) {
      setError("Quantity must be a whole number, 0 or more.");
      return null;
    }
    return { price: Number(price.trim()), quantity: Number(quantity.trim()) };
  };

  // Sends a change. Approve and Decline go back to the list (which reloads
  // itself); Save stays here so several changes can be made in a row.
  const run = async (action: () => Promise<unknown>, after: "back" | "stay" = "back") => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await action();
      if (after === "back") {
        goBack();
        return;
      }
      setSaved(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Something went wrong. Try again.");
    }
    setSaving(false);
  };

  const save = () => {
    const values = readValues();
    if (!values) return;
    const lowStock: LowStockChange = {};
    if (canSetLowStock) {
      if (!WHOLE_NUMBER.test(lowStockAt.trim())) {
        setError("Low stock at must be a whole number, 0 or more.");
        return;
      }
      if (lowStockAt.trim() !== savedLevel) lowStock.low_stock_threshold = Number(lowStockAt.trim());
      if (buyer !== savedBuyer) {
        if (buyer === null) lowStock.clear_buyer = true;
        else if (buyer !== "keep") lowStock.buyer_user_id = buyer;
      }
    }
    run(async () => {
      await updateStock(productId, storeId, canManageInventory ? { ...values, status } : { quantity: values.quantity });
      if (Object.keys(lowStock).length > 0) {
        await updateLowStockSettings(storeId, [productId], lowStock);
        setSavedLevel(lowStockAt.trim());
        if (buyer !== "keep") setSavedBuyer(buyer);
      }
    }, "stay");
  };

  const approve = () => {
    const values = readValues();
    if (values) run(() => approveEntry(productId, storeId, values));
  };

  const decline = () =>
    Alert.alert(
      "Decline this product?",
      `${params.name || "It"} will be removed from this store's pending list.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: () => run(() => removeEntry(productId, storeId)) },
      ],
    );

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <ThemedView style={styles.container}>
      {/* Product names are long, so the name goes under the photo, like Product details */}
      <ScreenHeader
        title={params.storeName || "Inventory"}
        eyebrow={canManageInventory ? "Inventory" : canEditStock ? "Stock count" : "Read-only inventory"}
        fallback="/admin/inventory"
        backLabel="Inventory"
        compact
      />
      <View style={styles.body}>
        <ScrollView
          style={styles.edgeToEdge}
          contentContainerStyle={[styles.content, styles.edgePadding]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >

          {params.image ? (
            <Image source={{ uri: params.image }} style={styles.image} contentFit="contain" />
          ) : (
            <ThemedView type="backgroundSelected" style={styles.image} />
          )}

          <ThemedText type="subtitle" style={styles.name}>
            {params.name || `Product ${productId}`}
          </ThemedText>
          {pending && (
            <ThemedText themeColor="textSecondary">
              {canManageInventory
                ? "Set the price and stock count to approve this product."
                : "Waiting for manager approval."}
            </ThemedText>
          )}
        
          <View style={styles.field}>
            <ThemedText type="smallBold">Price ($)</ThemedText>
            {canManageInventory ? (
              <TextInput
                value={price}
                onChangeText={setPrice}
                placeholder="89.99"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                ref={priceField}
                onFocus={() => setTyping("price")}
                onBlur={() => setTyping(null)}
                caretHidden={barShowing}
                style={inputStyle}
              />
            ) : (
              <ThemedText>{price ? `$${price}` : "Price not set"}</ThemedText>
            )}
          </View>

          <View style={styles.field}>
            <ThemedText type="smallBold">Quantity in stock</ThemedText>
            {canEditStock ? (
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                placeholder="0"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                ref={quantityField}
                onFocus={() => setTyping("quantity")}
                onBlur={() => setTyping(null)}
                caretHidden={barShowing}
                style={inputStyle}
              />
            ) : (
              <ThemedText>{quantity}</ThemedText>
            )}
          </View>

          {!pending && canManageInventory && (
            <View style={styles.field}>
              <ThemedText type="smallBold">Status</ThemedText>
              <View style={styles.choices}>
                {(["active", "discontinued"] as const).map((choice) => (
                  <Pressable
                    key={choice}
                    onPress={() => setStatus(choice)}
                    style={({ pressed }) => [styles.choicePress, pressed && styles.pressed]}
                  >
                    <ThemedView
                      type={choice === status ? "backgroundSelected" : "backgroundElement"}
                      style={styles.choice}
                    >
                      <ThemedText type={choice === status ? "smallBold" : "small"}>
                        {choice === "active" ? "Selling" : "Discontinued"}
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                ))}
              </View>
              {status === "discontinued" && (
                <ThemedText type="small" themeColor="textSecondary">
                  This product is hidden in search. Scanning it shows that it is discontinued here.
                </ThemedText>
              )}
            </View>
          )}

          {canSetLowStock && (
            <>
              <View style={styles.field}>
                <ThemedText type="smallBold">Low stock at</ThemedText>
                <TextInput
                  value={lowStockAt}
                  onChangeText={setLowStockAt}
                  placeholder="10"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
              ref={lowStockField}
              onFocus={() => setTyping("lowStock")}
              onBlur={() => setTyping(null)}
              caretHidden={barShowing}
                  style={inputStyle}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  Managers are alerted when the stock drops to this number or below.
                </ThemedText>
              </View>
              <View style={styles.field}>
                <ThemedText type="smallBold">Buyer</ThemedText>
                <BuyerPicker buyers={buyers} value={buyer} onChange={setBuyer} />
              </View>
            </>
          )}

          {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
          {saved && <ThemedText type="smallBold">Changes saved ✓</ThemedText>}

          {canEditStock && (saving ? (
            <ActivityIndicator />
          ) : pending ? (
            <View style={styles.actions}>
              <Button label="Approve" onPress={approve} />
              <Button label="Decline" onPress={decline} quiet />
            </View>
          ) : (
            <Button label={canManageInventory ? "Save changes" : "Save stock count"} onPress={save} />
          ))}
        </ScrollView>
      </View>
      <KeyboardDoneBar
        label={
          typing === "price"
            ? "Price ($)"
            : typing === "quantity"
              ? "Quantity in stock"
              : typing === "lowStock"
                ? "Low stock at"
                : null
        }
        value={typing === "price" ? price : typing === "quantity" ? quantity : lowStockAt}
        field={
          typing === "price"
            ? priceField
            : typing === "quantity"
              ? quantityField
              : typing === "lowStock"
                ? lowStockField
                : null
        }
        onShowingChange={setBarShowing}
      />
    </ThemedView>
  );
}

// The screen's buttons: the main action in red, the others outlined
function Button({ label, onPress, quiet = false }: { label: string; onPress: () => void; quiet?: boolean }) {
  return <AppButton label={label} onPress={onPress} variant={quiet ? "secondary" : "primary"} />;
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
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  section: {
    gap: Spacing.one,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  choices: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  choicePress: {
    flex: 1,
  },
  choice: {
    alignItems: "center",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  actions: {
    gap: Spacing.two,
  },
  button: {
    alignItems: "center",
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
  // Product photos have see-through backgrounds, so they sit on white in both light and dark mode
  // Same size as the product name on Product details
  name: {
    fontSize: 26,
    lineHeight: 32,
  },
  image: {
    width: "100%",
    height: 180,
    borderRadius: Spacing.three,
    backgroundColor: "#ffffff",
  },
});
