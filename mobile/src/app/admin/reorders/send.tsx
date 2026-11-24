import { Redirect, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listStoreBuyers, type StoreBuyer } from "@/api/inventory";
import { fitLabel, type ProductFit } from "@/api/products";
import { getReorderLines, sendOrderRequest, type ReorderLine } from "@/api/reorders";
import { BuyerPicker, type BuyerChoice } from "@/components/buyer-picker";
import { useAuth } from "@/auth/AuthContext";
import { canAccessStore } from "@/auth/store-access";
import { KeyboardDoneBar } from "@/components/keyboard-done-bar";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Brand, MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const WHOLE_NUMBER = /^\d+$/;

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  ordered: "Ordered",
};

// The products picked on Reorders, each with its sizes/colors, grouped by the
// products' buyer: each group goes to its buyer as one Order Request.
type Product = { productId: number; lines: ReorderLine[] };
type Group = { key: string; buyerId: number | null; buyerEmail: string | null; products: Product[] };

function groupLines(lines: ReorderLine[]): Group[] {
  const groups = new Map<string, Group>();
  for (const line of lines) {
    const key = String(line.buyer_user_id ?? "none");
    if (!groups.has(key))
      groups.set(key, { key, buyerId: line.buyer_user_id, buyerEmail: line.buyer_email, products: [] });
    const group = groups.get(key)!;
    let product = group.products.find((p) => p.productId === line.product_id);
    if (!product) {
      product = { productId: line.product_id, lines: [] };
      group.products.push(product);
    }
    product.lines.push(line);
  }
  // Products with no buyer last
  return [...groups.values()].sort((a, b) => Number(a.buyerId === null) - Number(b.buyerId === null));
}

// Low only shows the sizes that are low or that a buyer couldn't get
const isLowRow = (line: ReorderLine) => line.low || line.status === "unavailable" || line.status === "open";

// "Size 9", or the color for products that only come in colors
const rowLabel = (line: ReorderLine) => (line.size ? `Size ${line.size}` : line.color ?? "Quantity");

// Which number field is being typed in, for the bar above the keyboard
type Typing = { kind: "line"; line: ReorderLine } | { kind: "same"; productId: number } | null;

// Reorders -> check products -> Reorder. /admin/reorders/send?storeId=1&productIds=4,9
export default function ReorderScreen() {
  const params = useLocalSearchParams<{ storeId: string; storeName?: string; productIds?: string }>();
  const storeId = Number(params.storeId);
  const productIds = (params.productIds ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  const { profile, hasPermission } = useAuth();
  if (!hasPermission("manage_inventory") || !canAccessStore(profile, storeId) || productIds.length === 0) {
    return <Redirect href="/admin/reorders" />;
  }
  return (
    <SendOrderForm
      storeId={storeId}
      storeName={params.storeName || "this store"}
      productIds={productIds}
    />
  );
}

function SendOrderForm({
  storeId,
  storeName,
  productIds,
}: {
  storeId: number;
  storeName: string;
  productIds: number[];
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [lines, setLines] = useState<ReorderLine[]>([]);
  const [buyers, setBuyers] = useState<StoreBuyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  // Per size: the quantity typed (empty = don't order). Per product: showing
  // every size instead of just the low ones, the "same for all" number, and
  // whether it was taken off this order. Per group: the note.
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [allSizes, setAllSizes] = useState<Set<number>>(new Set());
  const [same, setSame] = useState<Record<number, string>>({});
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pickedBuyer, setPickedBuyer] = useState<BuyerChoice>(null);
  const [rememberBuyer, setRememberBuyer] = useState(true);

  const [typing, setTyping] = useState<Typing>(null);
  const [barShowing, setBarShowing] = useState(false);
  const fieldRefs = useRef(new Map<string, TextInput>());
  const typingField = useRef<TextInput | null>(null);
  const keepRef = (key: string) => (input: TextInput | null) => {
    if (input) fieldRefs.current.set(key, input);
    else fieldRefs.current.delete(key);
  };
  const startTyping = (key: string, next: Typing) => {
    typingField.current = fieldRefs.current.get(key) ?? null;
    setTyping(next);
  };

  const idsKey = productIds.join(",");
  const load = useCallback(async () => {
    setError(null);
    try {
      const ids = idsKey.split(",").map(Number);
      const [loaded, storeBuyers] = await Promise.all([getReorderLines(storeId, ids), listStoreBuyers(storeId)]);
      setLines(loaded);
      setBuyers(storeBuyers);
      // Low sizes start at the suggested amount; the rest start empty
      setQuantities((previous) => {
        const next = { ...previous };
        for (const line of loaded) {
          if (!line.sendable) delete next[line.variant_id];
          else if (next[line.variant_id] === undefined && isLowRow(line))
            next[line.variant_id] = String(line.suggested_quantity);
        }
        return next;
      });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not load the products.");
    } finally {
      setLoading(false);
    }
  }, [storeId, idsKey]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const groups = groupLines(lines.filter((line) => !removed.has(line.product_id)));

  // The sizes showing for a product: low ones unless All sizes is on.
  // A product with only one option always shows it.
  const shownLines = (product: Product) =>
    product.lines.length === 1 || allSizes.has(product.productId)
      ? product.lines
      : product.lines.filter(isLowRow);

  // What a group would send: showing, sendable rows with a number
  const toSend = (group: Group) =>
    group.products.flatMap((product) =>
      shownLines(product).filter((line) => line.sendable && (quantities[line.variant_id] ?? "").trim() !== ""),
    );

  const toggleAllSizes = (productId: number) =>
    setAllSizes((previous) => {
      const next = new Set(previous);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  // Puts one number on every showing size of a product
  const applySame = (product: Product) => {
    const typed = (same[product.productId] ?? "").trim();
    if (!WHOLE_NUMBER.test(typed) || Number(typed) === 0) {
      setError("Enter a whole number above 0 to set for every size.");
      return;
    }
    Keyboard.dismiss();
    setError(null);
    setQuantities((previous) => {
      const next = { ...previous };
      for (const line of shownLines(product)) if (line.sendable) next[line.variant_id] = typed;
      return next;
    });
  };

  const send = async (group: Group) => {
    Keyboard.dismiss();
    setError(null);
    setMessage(null);
    const noBuyer = group.buyerId === null;
    const buyerId = group.buyerId ?? (typeof pickedBuyer === "number" ? pickedBuyer : null);
    if (buyerId === null) {
      setError("Pick a buyer to send these to.");
      return;
    }
    const rows = toSend(group);
    for (const line of rows) {
      const typed = quantities[line.variant_id].trim();
      if (!WHOLE_NUMBER.test(typed) || Number(typed) === 0) {
        setError(`Enter a whole number above 0 for ${line.name} ${rowLabel(line)}, or clear it.`);
        return;
      }
    }
    setBusyGroup(group.key);
    try {
      await sendOrderRequest(
        storeId,
        buyerId,
        rows.map((line) => ({ variant_id: line.variant_id, quantity: Number(quantities[line.variant_id]) })),
        notes[group.key] ?? "",
        noBuyer && rememberBuyer,
      );
      const email = buyers.find((buyer) => buyer.user_id === buyerId)?.email ?? "the buyer";
      setMessage(`Order request sent to ${email} for ${rows.length} item${rows.length === 1 ? "" : "s"}.`);
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not send the order request.");
    } finally {
      setBusyGroup(null);
    }
  };

  const inputColors = { color: theme.text, backgroundColor: theme.background };

  const quantityField = (line: ReorderLine) => {
    const key = `line-${line.variant_id}`;
    return (
      <TextInput
        ref={keepRef(key)}
        value={quantities[line.variant_id] ?? ""}
        onChangeText={(text) => setQuantities((previous) => ({ ...previous, [line.variant_id]: text }))}
        onFocus={() => startTyping(key, { kind: "line", line })}
        onBlur={() => setTyping(null)}
        caretHidden={barShowing}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={`Order ${line.name} ${rowLabel(line)}`}
        style={[styles.quantityInput, inputColors]}
      />
    );
  };

  // One size: "Size 9   0 in stock ● low   [ 6 ]"
  const lineRow = (line: ReorderLine) => (
    <View key={line.variant_id} style={styles.line}>
      <ThemedText type="small" style={styles.lineName} numberOfLines={1}>
        {rowLabel(line)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.lineStock} numberOfLines={1}>
        {`${line.quantity} in stock`}
        {line.low && <ThemedText type="small" style={{ color: theme.danger }}>{"  ● low"}</ThemedText>}
      </ThemedText>
      {line.sendable ? (
        quantityField(line)
      ) : (
        <ThemedText type="small" themeColor="textSecondary" style={styles.lineStatus}>
          {STATUS_LABEL[line.status ?? ""] ?? "Sent"}
        </ThemedText>
      )}
    </View>
  );

  const productCard = (product: Product) => {
    const first = product.lines[0];
    const shown = shownLines(product);
    const showingAll = allSizes.has(product.productId);
    const hasOptions = product.lines.length > 1;
    const colors = [...new Set(shown.map((line) => line.color))];
    const sameKey = `same-${product.productId}`;
    return (
      <View key={product.productId} style={[styles.product, { borderColor: theme.border }]}>
        <View style={styles.productTop}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{first.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[first.brand, fitLabel(first.fit as ProductFit | null)].filter(Boolean).join(" · ")}
            </ThemedText>
          </View>
          <Pressable
            onPress={() => setRemoved((previous) => new Set(previous).add(product.productId))}
            hitSlop={8}
            accessibilityLabel={`Take ${first.name} off this order`}
          >
            <ThemedText type="small" themeColor="textSecondary">Remove</ThemedText>
          </Pressable>
        </View>

        {hasOptions && (
          // A two-way switch: the picked side is a navy thumb inside a grey track
          <View style={[styles.toggle, { backgroundColor: theme.backgroundElement }]}>
            {[false, true].map((all) => {
              const on = showingAll === all;
              return (
                <Pressable
                  key={String(all)}
                  onPress={() => !on && toggleAllSizes(product.productId)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.toggleSide, on && styles.toggleThumb]}
                >
                  <ThemedText
                    type="small"
                    themeColor={on ? undefined : "textSecondary"}
                    style={[styles.toggleText, on && styles.thumbText]}
                  >
                    {all ? "All sizes" : "Low only"}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )}

        {shown.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No low sizes. Tap All sizes to choose any size.
          </ThemedText>
        ) : (
          colors.map((color) => (
            <View key={color ?? "none"} style={styles.colorGroup}>
              {color && shown.some((line) => line.size) && (
                <ThemedText type="smallBold" themeColor="textSecondary">{color}</ThemedText>
              )}
              {shown.filter((line) => line.color === color).map(lineRow)}
            </View>
          ))
        )}

        {/* One number for every showing size */}
        {hasOptions && shown.some((line) => line.sendable) && (
          <View style={styles.sameRow}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
              {`Same for all ${shown.length} shown`}
            </ThemedText>
            <TextInput
              ref={keepRef(sameKey)}
              value={same[product.productId] ?? ""}
              onChangeText={(text) => setSame((previous) => ({ ...previous, [product.productId]: text }))}
              onFocus={() => startTyping(sameKey, { kind: "same", productId: product.productId })}
              onBlur={() => setTyping(null)}
              caretHidden={barShowing}
              keyboardType="number-pad"
              placeholder="Qty"
              placeholderTextColor={theme.textSecondary}
              style={[styles.quantityInput, inputColors]}
            />
            <Pressable onPress={() => applySame(product)} hitSlop={8}>
              <ThemedText type="linkPrimary">Apply</ThemedText>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title="Reorder"
        eyebrow="Reorders"
        subtitle={storeName}
        fallback="/admin/reorders"
        backLabel="Reorders"
      />
      <View style={styles.body}>
        <ScrollView
          style={styles.edgeToEdge}
          contentContainerStyle={[styles.content, styles.edgePadding, { paddingBottom: insets.bottom + Spacing.six }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <ThemedText type="small" themeColor="textSecondary">
            Enter how many of each size to order; empty sizes aren&apos;t ordered. Each buyer gets one Order
            Request.
          </ThemedText>

          {loading && <ActivityIndicator />}
          {error && <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>}
          {message && <ThemedText type="smallBold">{message}</ThemedText>}
          {!loading && groups.length === 0 && (
            <ThemedText themeColor="textSecondary">No products left on this order.</ThemedText>
          )}

          {groups.map((group) => {
            const rows = toSend(group);
            const busy = busyGroup === group.key;
            const noBuyer = group.buyerId === null;
            const sendTo = noBuyer
              ? buyers.find((buyer) => buyer.user_id === pickedBuyer)?.email
              : group.buyerEmail;
            return (
              <ThemedView key={group.key} type="card" style={[styles.group, { borderColor: theme.border }]}>
                <ThemedText type="smallBold">
                  {noBuyer ? "No buyer assigned" : `To ${group.buyerEmail}`}
                  <ThemedText type="small" themeColor="textSecondary">
                    {`  ·  ${group.products.length} product${group.products.length === 1 ? "" : "s"}`}
                  </ThemedText>
                </ThemedText>

                {noBuyer && (
                  <View style={styles.field}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Send these to
                    </ThemedText>
                    <BuyerPicker buyers={buyers} value={pickedBuyer} onChange={setPickedBuyer} />
                    <Pressable onPress={() => setRememberBuyer((was) => !was)} hitSlop={8}>
                      <ThemedText type="small">
                        {`${rememberBuyer ? "☑" : "☐"} Save as these products' buyer`}
                      </ThemedText>
                    </Pressable>
                  </View>
                )}

                {group.products.map(productCard)}

                <View style={styles.field}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Note for the buyer (optional)
                  </ThemedText>
                  <TextInput
                    value={notes[group.key] ?? ""}
                    onChangeText={(text) => setNotes((previous) => ({ ...previous, [group.key]: text }))}
                    placeholder="e.g. Stocking up for Black Friday."
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    style={[styles.note, inputColors]}
                  />
                </View>

                {busy ? (
                  <ActivityIndicator />
                ) : (
                  <AppButton
                    label={`Send order request (${rows.length} item${rows.length === 1 ? "" : "s"})`}
                    onPress={() => send(group)}
                    disabled={rows.length === 0 || (noBuyer && !sendTo)}
                  />
                )}
              </ThemedView>
            );
          })}
        </ScrollView>
      </View>
      <KeyboardDoneBar
        label={
          typing?.kind === "line"
            ? `Order ${typing.line.name} ${rowLabel(typing.line)}`
            : typing?.kind === "same"
              ? "Same for every size shown"
              : null
        }
        value={
          typing?.kind === "line"
            ? quantities[typing.line.variant_id] ?? ""
            : typing?.kind === "same"
              ? same[typing.productId] ?? ""
              : ""
        }
        field={typing ? typingField : null}
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
  },
  content: {
    gap: Spacing.three,
  },
  flex: {
    flex: 1,
  },
  group: {
    padding: Spacing.three,
    borderRadius: Radius.medium,
    gap: Spacing.three,
    borderWidth: 1,
  },
  field: {
    gap: Spacing.one,
  },
  // A product inside a buyer's group: heading, toggle, sizes by color
  product: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
  },
  productTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  // Pulled left by its padding so "Low only" lines up with the product name
  // and the sizes below
  toggle: {
    flexDirection: "row",
    alignSelf: "flex-start",
    padding: 2,
    marginLeft: -(2 + Spacing.two),
    borderRadius: Radius.small + 2,
  },
  toggleSide: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.small,
  },
  toggleThumb: {
    backgroundColor: Brand.navy,
  },
  toggleText: {
    fontWeight: "600",
  },
  thumbText: {
    color: "#ffffff",
  },
  colorGroup: {
    gap: Spacing.one,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  lineName: {
    width: 96,
  },
  lineStock: {
    flex: 1,
  },
  lineStatus: {
    width: 72,
    textAlign: "center",
  },
  sameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  quantityInput: {
    width: 72,
    fontSize: 16,
    textAlign: "center",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  note: {
    fontSize: 15,
    minHeight: 64,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    textAlignVertical: "top",
  },
});
