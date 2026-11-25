import { Redirect, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
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

import {
  describeSummary,
  getOrderRequest,
  updateOrderItems,
  reassignOrderRequest,
  type OrderRequest,
} from "@/api/reorders";
import { useAuth } from "@/auth/AuthContext";
import { canAccessStore } from "@/auth/store-access";
import { listStoreBuyers, type StoreBuyer } from "@/api/inventory";
import { BuyerPicker, type BuyerChoice } from "@/components/buyer-picker";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { Checkbox } from '@/components/ui/checkbox';

type Item = OrderRequest["items"][number];

function itemStatus(item: Item): string {
  if (item.restocked && item.status !== "unavailable") return "Received";
  if (item.status === "ordered") return "Ordered";
  if (item.status === "unavailable") return "Unavailable";
  return "Pending";
}

// "Size 9", the color for color-only products, or "Quantity" for neither
const itemLabel = (item: Item) => (item.size ? `Size ${item.size}` : item.color ?? "Quantity");

// The request's items grouped by product, then color, in the order sent
type ProductGroup = { productId: number; name: string; colors: { color: string | null; items: Item[] }[] };
function groupItems(items: Item[]): ProductGroup[] {
  const products: ProductGroup[] = [];
  for (const item of items) {
    let product = products.find((p) => p.productId === item.product_id);
    if (!product) {
      product = { productId: item.product_id, name: item.name, colors: [] };
      products.push(product);
    }
    let color = product.colors.find((c) => c.color === (item.color ?? null));
    if (!color) {
      color = { color: item.color ?? null, items: [] };
      product.colors.push(color);
    }
    color.items.push(item);
  }
  return products;
}

// One Order Request: the formal message, and each product's status. The buyer
// ticks products and marks them ordered or unavailable (with a reason); the
// store's managers see the same screen without the buttons.
// /admin/reorders/12
export default function OrderRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Number(id);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, hasPermission } = useAuth();
  const isManager = hasPermission("manage_inventory");

  const [request, setRequest] = useState<OrderRequest | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [buyers, setBuyers] = useState<StoreBuyer[]>([]);
  const [replacement, setReplacement] = useState<BuyerChoice>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await getOrderRequest(requestId);
      setRequest(loaded);
      if (isManager && loaded.summary.pending > 0) setBuyers(await listStoreBuyers(loaded.store_id));
    } catch (problem) {
      setRequest(null);
      setError(problem instanceof Error ? problem.message : "Could not load the order request.");
    }
  }, [requestId, isManager]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const hasStoreAccess = request !== null && canAccessStore(profile, request.store_id);
  const isBuyer = hasStoreAccess && profile?.role === "store_buyer" && profile.user_id === request?.buyer_user_id;
  // A replacement inherits pending work, never another buyer's completed responses.
  const changeable = (request?.items ?? []).filter((item) => !item.restocked &&
    (item.status === "pending" || item.updated_by === profile?.user_id));
  const allSelected = changeable.length > 0 && changeable.every((item) => selected.has(item.alert_id));

  // Check or uncheck a whole product, one color, or one size at once
  const isChangeable = (item: Item) => changeable.includes(item);
  const checkState = (items: Item[]): boolean | "some" => {
    const mine = items.filter(isChangeable);
    const on = mine.filter((item) => selected.has(item.alert_id)).length;
    return on === 0 ? false : on === mine.length ? true : "some";
  };
  const toggleItems = (items: Item[]) => {
    const mine = items.filter(isChangeable);
    const allOn = mine.every((item) => selected.has(item.alert_id));
    setSelected((previous) => {
      const next = new Set(previous);
      for (const item of mine) {
        if (allOn) next.delete(item.alert_id);
        else next.add(item.alert_id);
      }
      return next;
    });
  };

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(changeable.map((item) => item.alert_id)));

  const mark = async (status: "ordered" | "unavailable") => {
    if (status === "unavailable" && !reason.trim()) {
      setError("Say why these products are unavailable.");
      return;
    }
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const count = selected.size;
      setRequest(await updateOrderItems(requestId, [...selected], status, reason));
      setMessage(
        `Marked ${count} item${count === 1 ? "" : "s"} ${status}. The store's managers have been notified.`,
      );
      setSelected(new Set());
      setAskingReason(false);
      setReason("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not update the order request.");
    } finally {
      setSaving(false);
    }
  };

  const reassign = async () => {
    if (typeof replacement !== "number") return;
    setSaving(true);
    setError(null);
    try {
      setRequest(await reassignOrderRequest(requestId, replacement));
      setSelected(new Set());
      setReplacement(null);
      setMessage("Buyer reassigned and notified. Existing responses are preserved.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not reassign the buyer.");
    } finally {
      setSaving(false);
    }
  };

  if (request && (!hasStoreAccess || (!isManager && !isBuyer))) return <Redirect href="/manage" />;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title="Order Request"
        eyebrow="Reorders"
        subtitle={request ? `${request.store_name} · ${new Date(request.created_at).toLocaleString()}` : undefined}
        fallback="/admin/reorders"
        backLabel="Reorders"
      />
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + Spacing.three },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {!request && !error && <ActivityIndicator />}

          {request && (
            <>
              <ThemedView type="backgroundElement" style={styles.status}>
                <ThemedText type="smallBold">{describeSummary(request.summary)}</ThemedText>
                {request.needs_reassignment && <ThemedText style={{ color: theme.danger }}>Needs reassignment: the previous buyer no longer has access.</ThemedText>}
              </ThemedView>

              {isManager && request.summary.pending > 0 && (
                <ThemedView type="card" style={[styles.letter, { borderColor: theme.border }]}>
                  <ThemedText type="smallBold">Reassign buyer</ThemedText>
                  <ThemedText type="small">{`Current buyer: ${request.buyer_email ?? "none"}. Only pending work transfers; existing statuses and reasons stay saved.`}</ThemedText>
                  <BuyerPicker buyers={buyers} value={replacement} onChange={setReplacement} />
                  <AppButton label="Reassign buyer" onPress={reassign}
                    disabled={saving || typeof replacement !== "number" || replacement === request.buyer_user_id} />
                </ThemedView>
              )}

              {request.reassignments.map((entry, index) => (
                <ThemedText key={`${entry.created_at}-${index}`} type="small" themeColor="textSecondary">
                  {`${entry.from_buyer_email ?? "Unassigned"} → ${entry.to_buyer_email ?? "Removed buyer"}, by ${entry.changed_by_email ?? "removed manager"} · ${new Date(entry.created_at).toLocaleString()}`}
                </ThemedText>
              ))}

              <ThemedView type="card" style={[styles.letter, { borderColor: theme.border }]}>
                <ThemedText type="small">{request.message}</ThemedText>
              </ThemedView>

              <View style={styles.listTop}>
                <ThemedText type="smallBold" style={styles.flex}>
                  Products
                </ThemedText>
                {isBuyer && changeable.length > 0 && (
                  <Pressable onPress={toggleAll} hitSlop={8}>
                    <ThemedText type="linkPrimary">{allSelected ? "Unselect all" : "Select all"}</ThemedText>
                  </Pressable>
                )}
              </View>

              {groupItems(request.items).map((product) => {
                const productItems = product.colors.flatMap((c) => c.items);
                const canCheckProduct = isBuyer && productItems.some(isChangeable);
                const units = productItems.reduce((sum, item) => sum + item.quantity, 0);
                const hasOptions = productItems.some((item) => item.color || item.size);
                return (
                  <ThemedView key={product.productId} type="card" style={[styles.product, { borderColor: theme.border }]}>
                    {/* The product: its checkbox picks every size in it */}
                    <View style={styles.productTop}>
                      {canCheckProduct && (
                        <Checkbox
                          checked={checkState(productItems)}
                          onPress={() => toggleItems(productItems)}
                          label={`Select every ${product.name} item`}
                        />
                      )}
                      <View style={styles.flex}>
                        <ThemedText type="smallBold">{product.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {hasOptions
                            ? `${productItems.length} item${productItems.length === 1 ? "" : "s"} · ${units} units`
                            : `${units} units · ${itemStatus(productItems[0])}`}
                        </ThemedText>
                      </View>
                    </View>

                    {hasOptions &&
                      product.colors.map((group) => {
                        const canCheckColor = isBuyer && group.items.some(isChangeable);
                        return (
                          <View key={group.color ?? "none"} style={styles.colorGroup}>
                            {/* A color: its checkbox picks all its sizes */}
                            {group.color && group.items.some((item) => item.size) && (
                              <View style={styles.colorTop}>
                                {canCheckColor && (
                                  <Checkbox
                                    checked={checkState(group.items)}
                                    onPress={() => toggleItems(group.items)}
                                    label={`Select every ${group.color} size`}
                                  />
                                )}
                                <ThemedText type="smallBold" themeColor="textSecondary">{group.color}</ThemedText>
                              </View>
                            )}
                            {group.items.map((item) => {
                              const canChange = isBuyer && isChangeable(item);
                              const unavailable = item.status === "unavailable";
                              return (
                                <View key={item.alert_id} style={styles.itemRow}>
                                  {canChange ? (
                                    <Checkbox
                                      checked={selected.has(item.alert_id)}
                                      onPress={() => toggleItems([item])}
                                      label={`Select ${product.name} ${itemLabel(item)}`}
                                    />
                                  ) : (
                                    isBuyer && <View style={styles.checkboxSpace} />
                                  )}
                                  <ThemedText type="small" style={styles.itemName} numberOfLines={1}>
                                    {itemLabel(item)}
                                  </ThemedText>
                                  <ThemedText type="small" themeColor="textSecondary" style={styles.itemUnits}>
                                    {`${item.quantity} unit${item.quantity === 1 ? "" : "s"}`}
                                  </ThemedText>
                                  <ThemedText
                                    type="small"
                                    themeColor={unavailable ? undefined : "textSecondary"}
                                    style={[styles.itemStatus, unavailable && { color: theme.danger }]}
                                    numberOfLines={1}
                                  >
                                    {itemStatus(item)}
                                  </ThemedText>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })}

                    {/* Reasons and who updated, once per product rather than on every size */}
                    {[...new Set(productItems.filter((item) => item.status === "unavailable").map((item) => item.reason))].map(
                      (why) => (
                        <ThemedText key={why} type="small" style={{ color: theme.danger }}>
                          {`Unavailable: ${why || "no reason given"}`}
                        </ThemedText>
                      ),
                    )}
                    {[...new Set(productItems.map((item) => item.updated_by_email).filter(Boolean))].map((email) => (
                      <ThemedText key={email} type="small" themeColor="textSecondary">
                        {`Updated by ${email}`}
                      </ThemedText>
                    ))}
                  </ThemedView>
                );
              })}

              {isBuyer && selected.size > 0 && !askingReason && !saving && (
                <View style={styles.actions}>
                  <AppButton
                    label={`Mark ordered (${selected.size})`}
                    onPress={() => mark("ordered")}
                    size="small"
                    style={styles.flex}
                  />
                  <AppButton
                    label={`Unavailable (${selected.size})`}
                    onPress={() => setAskingReason(true)}
                    variant="secondary"
                    size="small"
                    style={styles.flex}
                  />
                </View>
              )}

              {isBuyer && askingReason && !saving && (
                <ThemedView type="backgroundElement" style={styles.reasonBox}>
                  <ThemedText type="smallBold">{`Why are these ${selected.size} unavailable?`}</ThemedText>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="e.g. Out of stock at the supplier until next month"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    autoFocus
                    style={[styles.reason, { color: theme.text, backgroundColor: theme.background }]}
                  />
                  <View style={styles.actions}>
                    <AppButton label="Mark unavailable" onPress={() => mark("unavailable")} size="small" style={styles.flex} />
                    <AppButton label="Cancel" onPress={() => setAskingReason(false)} variant="secondary" size="small" />
                  </View>
                </ThemedView>
              )}

              {saving && <ActivityIndicator />}
            </>
          )}

          {error && <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>}
          {message && <ThemedText type="smallBold">{message}</ThemedText>}
        </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // The page content under the navy band, centered on wide screens
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  flex: {
    flex: 1,
  },
  status: {
    alignSelf: "flex-start",
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  letter: {
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  listTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  // A product card: heading, then each color's sizes
  product: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  productTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  colorGroup: {
    gap: Spacing.one,
  },
  colorTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingTop: Spacing.one,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  // Keeps sizes lined up when some rows have no checkbox
  checkboxSpace: {
    width: 24,
  },
  itemName: {
    width: 84,
  },
  itemUnits: {
    width: 72,
  },
  itemStatus: {
    flex: 1,
    textAlign: "right",
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  reasonBox: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  reason: {
    fontSize: 15,
    minHeight: 64,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    textAlignVertical: "top",
  },
  pressed: {
    opacity: 0.6,
  },
});
