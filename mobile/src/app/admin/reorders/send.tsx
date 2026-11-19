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
import {
  getReorderGroups,
  sendOrderRequest,
  type ReorderGroup,
  type ReorderProduct,
} from "@/api/reorders";
import { BuyerPicker, type BuyerChoice } from "@/components/buyer-picker";
import { useAuth } from "@/auth/AuthContext";
import { canAccessStore } from "@/auth/store-access";
import { KeyboardDoneBar } from "@/components/keyboard-done-bar";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Spacing, Radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const WHOLE_NUMBER = /^\d+$/;

// A group's key: the buyer's id, or "none" for products with no buyer
const groupKey = (group: ReorderGroup) => String(group.buyer_user_id ?? "none");

// Which number field is being typed in, for the bar above the keyboard
type Typing = { kind: "item"; item: ReorderProduct } | { kind: "bulk"; key: string } | null;

// Low products that can be sent (needs reorder, or unavailable from a buyer),
// grouped by buyer. Each group is sent to its buyer as one Order Request.
// Opened from Reorders. /admin/reorders/send?storeId=1&storeName=...
export default function ReorderScreen() {
  const params = useLocalSearchParams<{ storeId: string; storeName?: string }>();
  const storeId = Number(params.storeId);
  const { profile, hasPermission } = useAuth();
  if (!hasPermission("manage_inventory") || !canAccessStore(profile, storeId)) {
    return <Redirect href="/admin/reorders" />;
  }
  return <SendOrderForm storeId={storeId} storeName={params.storeName || "this store"} />;
}

function SendOrderForm({ storeId, storeName }: { storeId: number; storeName: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [groups, setGroups] = useState<ReorderGroup[]>([]);
  const [buyers, setBuyers] = useState<StoreBuyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  // Per product: ticked or not, and the quantity typed. Per group: the note and
  // the "set quantity for selected" number. For products with no buyer: who to
  // send to, and whether to save them as those products' buyer.
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<Record<string, string>>({});
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const [loaded, storeBuyers] = await Promise.all([getReorderGroups(storeId), listStoreBuyers(storeId)]);
      setGroups(loaded);
      setBuyers(storeBuyers);
      // Fill in suggested quantities for products we haven't seen yet
      setQuantities((previous) => {
        const next = { ...previous };
        for (const group of loaded)
          for (const item of group.items)
            if (next[item.alert_id] === undefined) next[item.alert_id] = String(item.suggested_quantity);
        return next;
      });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not load the low-stock products.");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const ticked = (group: ReorderGroup) => group.items.filter((item) => !unticked.has(item.alert_id));

  const toggle = (alertId: number) =>
    setUnticked((previous) => {
      const next = new Set(previous);
      if (next.has(alertId)) next.delete(alertId);
      else next.add(alertId);
      return next;
    });

  const toggleAll = (group: ReorderGroup) => {
    const allTicked = ticked(group).length === group.items.length;
    setUnticked((previous) => {
      const next = new Set(previous);
      for (const item of group.items) {
        if (allTicked) next.add(item.alert_id);
        else next.delete(item.alert_id);
      }
      return next;
    });
  };

  // Puts one quantity on every ticked product in the group
  const applyBulk = (group: ReorderGroup) => {
    const typed = (bulk[groupKey(group)] ?? "").trim();
    if (!WHOLE_NUMBER.test(typed) || Number(typed) === 0) {
      setError("Enter a whole number above 0 to set for the selected products.");
      return;
    }
    Keyboard.dismiss();
    setError(null);
    setQuantities((previous) => {
      const next = { ...previous };
      for (const item of ticked(group)) next[item.alert_id] = typed;
      return next;
    });
  };

  const send = async (group: ReorderGroup) => {
    Keyboard.dismiss();
    setError(null);
    setMessage(null);
    const noBuyer = group.buyer_user_id === null;
    const buyerId = group.buyer_user_id ?? (typeof pickedBuyer === "number" ? pickedBuyer : null);
    if (buyerId === null) {
      setError("Pick a buyer to send these to.");
      return;
    }
    const items = ticked(group);
    for (const item of items) {
      const typed = (quantities[item.alert_id] ?? "").trim();
      if (!WHOLE_NUMBER.test(typed) || Number(typed) === 0) {
        setError(`Enter how many ${item.name} to order (a whole number above 0).`);
        return;
      }
    }
    setBusyGroup(groupKey(group));
    try {
      await sendOrderRequest(
        storeId,
        buyerId,
        items.map((item) => ({ alert_id: item.alert_id, quantity: Number(quantities[item.alert_id]) })),
        notes[groupKey(group)] ?? "",
        noBuyer && rememberBuyer,
      );
      const email = buyers.find((buyer) => buyer.user_id === buyerId)?.email ?? "the buyer";
      setMessage(`Order request sent to ${email} for ${items.length} product${items.length === 1 ? "" : "s"}.`);
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not send the order request.");
    } finally {
      setBusyGroup(null);
    }
  };

  const inputColors = { color: theme.text, backgroundColor: theme.background };

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
          contentContainerStyle={[[styles.content, { paddingBottom: insets.bottom + Spacing.six }], styles.edgePadding]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <ThemedText type="small" themeColor="textSecondary">
            {`Low-stock products at ${storeName}, grouped by buyer. Each group is sent to its buyer as one Order Request.`}
          </ThemedText>

          {loading && <ActivityIndicator />}
          {error && <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>}
          {message && <ThemedText type="smallBold">{message}</ThemedText>}
          {!loading && groups.length === 0 && (
            <ThemedText themeColor="textSecondary">Nothing needs reordering right now.</ThemedText>
          )}

          {groups.map((group) => {
            const key = groupKey(group);
            const selected = ticked(group);
            const allTicked = selected.length === group.items.length;
            const busy = busyGroup === key;
            const noBuyer = group.buyer_user_id === null;
            const sendTo = noBuyer
              ? buyers.find((buyer) => buyer.user_id === pickedBuyer)?.email
              : group.buyer_email;
            const bulkKey = `bulk-${key}`;
            return (
              <ThemedView key={key} type="card" style={[styles.group, { borderColor: theme.border }]}>
                <View style={styles.groupTop}>
                  <ThemedText type="smallBold" style={styles.flex}>
                    {noBuyer ? "No buyer assigned" : group.buyer_email}
                    <ThemedText type="small" themeColor="textSecondary">
                      {`  ·  ${group.items.length} product${group.items.length === 1 ? "" : "s"}`}
                    </ThemedText>
                  </ThemedText>
                  <Pressable onPress={() => toggleAll(group)} hitSlop={8}>
                    <ThemedText type="linkPrimary">{allTicked ? "Unselect all" : "Select all"}</ThemedText>
                  </Pressable>
                </View>

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

                {/* One quantity for every ticked product */}
                <View style={styles.bulkRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                    {`Set quantity for ${selected.length} selected`}
                  </ThemedText>
                  <TextInput
                    ref={keepRef(bulkKey)}
                    value={bulk[key] ?? ""}
                    onChangeText={(text) => setBulk((previous) => ({ ...previous, [key]: text }))}
                    onFocus={() => startTyping(bulkKey, { kind: "bulk", key })}
                    onBlur={() => setTyping(null)}
                    caretHidden={barShowing}
                    keyboardType="number-pad"
                    placeholder="Qty"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.quantityInput, inputColors]}
                  />
                  <Pressable
                    onPress={() => applyBulk(group)}
                    disabled={selected.length === 0}
                    style={({ pressed }) => (pressed || selected.length === 0) && styles.pressed}
                  >
                    <ThemedText type="linkPrimary">Apply</ThemedText>
                  </Pressable>
                </View>

                {group.items.map((item) => {
                  const isTicked = !unticked.has(item.alert_id);
                  const itemKey = `item-${item.alert_id}`;
                  return (
                    <View key={item.alert_id} style={[styles.item, !isTicked && styles.faded]}>
                      <Pressable onPress={() => toggle(item.alert_id)} hitSlop={8}>
                        <ThemedText type="small">{isTicked ? "☑" : "☐"}</ThemedText>
                      </Pressable>
                      <View style={styles.flex}>
                        <ThemedText type="smallBold">{item.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {`${item.quantity} left · low at ${item.low_stock_threshold}`}
                        </ThemedText>
                        {item.status === "unavailable" && (
                          <ThemedText type="small" style={{ color: theme.danger }}>
                            {`Unavailable from ${item.requested_from ?? "the buyer"}: ${item.reason || "no reason given"}`}
                          </ThemedText>
                        )}
                      </View>
                      <View style={styles.quantity}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Order
                        </ThemedText>
                        <TextInput
                          ref={keepRef(itemKey)}
                          value={quantities[item.alert_id] ?? ""}
                          onChangeText={(text) =>
                            setQuantities((previous) => ({ ...previous, [item.alert_id]: text }))
                          }
                          onFocus={() => startTyping(itemKey, { kind: "item", item })}
                          onBlur={() => setTyping(null)}
                          caretHidden={barShowing}
                          editable={isTicked}
                          keyboardType="number-pad"
                          style={[styles.quantityInput, inputColors]}
                        />
                      </View>
                    </View>
                  );
                })}

                <View style={styles.field}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Note for the buyer (optional)
                  </ThemedText>
                  <TextInput
                    value={notes[key] ?? ""}
                    onChangeText={(text) => setNotes((previous) => ({ ...previous, [key]: text }))}
                    placeholder="e.g. Needed before the weekend sale."
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    style={[styles.note, inputColors]}
                  />
                </View>

                {busy ? (
                  <ActivityIndicator />
                ) : (
                  <AppButton
                    label={`Send order request (${selected.length})`}
                    onPress={() => send(group)}
                    disabled={selected.length === 0 || (noBuyer && !sendTo)}
                  />
                )}
              </ThemedView>
            );
          })}
        </ScrollView>
      </View>
      <KeyboardDoneBar
        label={
          typing?.kind === "item"
            ? `Order ${typing.item.name}`
            : typing?.kind === "bulk"
              ? "Quantity for selected"
              : null
        }
        value={
          typing?.kind === "item"
            ? quantities[typing.item.alert_id] ?? ""
            : typing?.kind === "bulk"
              ? bulk[typing.key] ?? ""
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
    gap: Spacing.two,
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
  groupTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
  },
  bulkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  faded: {
    opacity: 0.45,
  },
  quantity: {
    alignItems: "flex-end",
    gap: Spacing.half,
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
  button: {
    alignItems: "center",
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});
