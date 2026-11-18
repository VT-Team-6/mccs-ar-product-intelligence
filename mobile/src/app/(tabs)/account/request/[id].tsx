import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  describeSummary,
  getOrderRequest,
  updateOrderItems,
  type OrderRequest,
} from "@/api/reorders";
import { useAuth } from "@/auth/AuthContext";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
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
// /account/request/12
export default function OrderRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Number(id);
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();

  const [request, setRequest] = useState<OrderRequest | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequest(await getOrderRequest(requestId));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not load the order request.");
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const isBuyer = request !== null && profile?.user_id === request.buyer_user_id;
  // Products the buyer can still change: anything not already received
  const changeable = (request?.items ?? []).filter((item) => !(item.restocked && item.status !== "unavailable"));
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

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/account/reorders"));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Pressable onPress={goBack} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary">‹ Back</ThemedText>
          </Pressable>

          {!request && !error && <ActivityIndicator />}

          {request && (
            <>
              <ThemedText type="subtitle">Order Request</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {`${request.store_name} · ${new Date(request.created_at).toLocaleString()}`}
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.status}>
                <ThemedText type="smallBold">{describeSummary(request.summary)}</ThemedText>
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.letter}>
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
                    <ThemedView type={isSelected ? "backgroundSelected" : "backgroundElement"} style={styles.item}>
                      {canChange && <ThemedText type="small">{isSelected ? "☑" : "☐"}</ThemedText>}
                      <View style={styles.flex}>
                        <ThemedText type="smallBold">{item.name}</ThemedText>
                        <ThemedText
                          type="small"
                          themeColor={item.status === "unavailable" ? undefined : "textSecondary"}
                          style={item.status === "unavailable" && styles.error}
                        >
                          {itemStatus(item)}
                        </ThemedText>
                      </View>
                      <ThemedText type="smallBold">{`${item.quantity} units`}</ThemedText>
                    </ThemedView>
                  </Pressable>
                );
              })}

              {isBuyer && selected.size > 0 && !askingReason && !saving && (
                <View style={styles.actions}>
                  <Pressable onPress={() => mark("ordered")} style={({ pressed }) => [styles.flex, pressed && styles.pressed]}>
                    <ThemedView type="backgroundSelected" style={styles.button}>
                      <ThemedText type="smallBold">{`Mark ordered (${selected.size})`}</ThemedText>
                    </ThemedView>
                  </Pressable>
                  <Pressable onPress={() => setAskingReason(true)} style={({ pressed }) => [styles.flex, pressed && styles.pressed]}>
                    <ThemedView type="backgroundElement" style={styles.button}>
                      <ThemedText type="smallBold">{`Mark unavailable (${selected.size})`}</ThemedText>
                    </ThemedView>
                  </Pressable>
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
                    <Pressable onPress={() => mark("unavailable")} style={({ pressed }) => [styles.flex, pressed && styles.pressed]}>
                      <ThemedView type="backgroundSelected" style={styles.button}>
                        <ThemedText type="smallBold">Mark unavailable</ThemedText>
                      </ThemedView>
                    </Pressable>
                    <Pressable onPress={() => setAskingReason(false)} style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView type="background" style={styles.button}>
                        <ThemedText type="small">Cancel</ThemedText>
                      </ThemedView>
                    </Pressable>
                  </View>
                </ThemedView>
              )}

              {saving && <ActivityIndicator />}
            </>
          )}

          {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
          {message && <ThemedText type="smallBold">{message}</ThemedText>}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
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
  content: {
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
    borderRadius: Spacing.three,
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
    borderRadius: Spacing.three,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  button: {
    alignItems: "center",
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
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
  error: {
    color: "#E5484D",
  },
  pressed: {
    opacity: 0.6,
  },
});
