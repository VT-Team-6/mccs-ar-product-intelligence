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
import { Brand, MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type Item = OrderRequest["items"][number];

function itemStatus(item: Item): string {
  if (item.restocked && item.status !== "unavailable") return "Received";
  if (item.status === "ordered") return "Ordered";
  if (item.status === "unavailable") return `Unavailable: ${item.reason}`;
  return "Pending";
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
  const allSelected = changeable.length > 0 && changeable.every((item) => selected.has(item.product_id));

  const toggle = (productId: number) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(changeable.map((item) => item.product_id)));

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
        `Marked ${count} product${count === 1 ? "" : "s"} ${status}. The store's managers have been notified.`,
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

              {request.items.map((item) => {
                const canChange = isBuyer && changeable.includes(item);
                const isSelected = selected.has(item.product_id);
                return (
                  <Pressable
                    key={item.product_id}
                    onPress={() => canChange && toggle(item.product_id)}
                    disabled={!canChange}
                  >
                    <ThemedView
                      type={isSelected ? "backgroundSelected" : "card"}
                      style={[styles.item, { borderColor: isSelected ? Brand.navy : theme.border }]}
                    >
                      {canChange && <ThemedText type="small">{isSelected ? "☑" : "☐"}</ThemedText>}
                      <View style={styles.flex}>
                        <ThemedText type="smallBold">{item.name}</ThemedText>
                        <ThemedText
                          type="small"
                          themeColor={item.status === "unavailable" ? undefined : "textSecondary"}
                          style={item.status === "unavailable" && { color: theme.danger }}
                        >
                          {itemStatus(item)}
                        </ThemedText>
                        {item.updated_by_email && <ThemedText type="small" themeColor="textSecondary">{`Updated by ${item.updated_by_email}`}</ThemedText>}
                      </View>
                      <ThemedText type="smallBold">{`${item.quantity} units`}</ThemedText>
                    </ThemedView>
                  </Pressable>
                );
              })}

              {isBuyer && selected.size > 0 && !askingReason && !saving && (
                <View style={styles.actions}>
                  <AppButton label={`Mark ordered (${selected.size})`} onPress={() => mark("ordered")} style={styles.flex} />
                  <AppButton
                    label={`Unavailable (${selected.size})`}
                    onPress={() => setAskingReason(true)}
                    variant="secondary"
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
                    <AppButton label="Mark unavailable" onPress={() => mark("unavailable")} style={styles.flex} />
                    <AppButton label="Cancel" onPress={() => setAskingReason(false)} variant="secondary" />
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
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
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
