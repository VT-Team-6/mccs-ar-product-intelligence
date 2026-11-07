import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";

import { useAuth } from "@/auth/AuthContext";
import {
  getProductStock,
  listStores,
  manageableStores,
  pushToStores,
  type Store,
} from "@/api/inventory";
import { type Product } from "@/api/products";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

type Props = {
  product: Product;
  visible: boolean;
  onClose: () => void;
};

// A popup to send a product to stores. Each store gets it as pending, and
// approves it with its own price from the Inventory screen.
export function SendToStoresModal({ product, visible, onClose }: Props) {
  const { profile } = useAuth();
  const [stores, setStores] = useState<Store[] | null>(null);
  // Stores already selling it, so they can't be picked again
  const [carried, setCarried] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Loads the stores each time the popup opens
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setStores(null);
    setSelected(new Set());
    setError(null);
    setMessage(null);
    Promise.all([listStores(), getProductStock(product.product_id)])
      .then(([all, stock]) => {
        if (cancelled) return;
        const mine = manageableStores(all, profile);
        const selling = new Set(stock.stores.map((entry) => entry.store_id));
        setStores(mine);
        setCarried(selling);
        // Only one choice: pick it for them
        const open = mine.filter((store) => !selling.has(store.store_id));
        if (open.length === 1) setSelected(new Set([open[0].store_id]));
      })
      .catch((problem: Error) => {
        if (!cancelled) setError(problem.message);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, product.product_id, profile]);

  function toggle(storeId: number) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  }

  async function send() {
    if (selected.size === 0 || !stores) return;
    setSending(true);
    setError(null);
    try {
      const pushed = await pushToStores([product.product_id], [...selected]);
      const name = (id: number) =>
        stores.find((store) => store.store_id === id)?.name ?? `Store ${id}`;
      const sent = pushed.filter((entry) => !entry.already_present);
      const already = pushed.filter((entry) => entry.already_present);
      setMessage(
        [
          sent.length > 0 &&
            `Sent to ${sent.map((e) => name(e.store_id)).join(", ")}. It's waiting in their Pending tab.`,
          already.length > 0 &&
            `Already at ${already.map((e) => name(e.store_id)).join(", ")}.`,
        ]
          .filter(Boolean)
          .join(" "),
      );
      setCarried((previous) => new Set([...previous, ...selected]));
      setSelected(new Set());
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not send the product.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* The empty onPress stops taps on the card from closing the popup */}
        <Pressable onPress={() => {}}>
          <ThemedView style={styles.card}>
            <ThemedText type="smallBold">Send {product.name} to stores</ThemedText>

            {!stores && !error && <ActivityIndicator />}
            {stores && stores.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                You don't manage any stores.
              </ThemedText>
            )}

            {stores && (
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {stores.map((store) => {
                  const isCarried = carried.has(store.store_id);
                  const isSelected = selected.has(store.store_id);
                  return (
                    <Pressable
                      key={store.store_id}
                      onPress={() => toggle(store.store_id)}
                      disabled={isCarried || sending}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView
                        type={isSelected ? "backgroundSelected" : "backgroundElement"}
                        style={[styles.row, isCarried && styles.disabled]}>
                        <ThemedText type="small">{isSelected ? "☑" : "☐"}</ThemedText>
                        <ThemedView type={isSelected ? "backgroundSelected" : "backgroundElement"} style={styles.rowText}>
                          <ThemedText type="smallBold">{store.name}</ThemedText>
                          {isCarried && (
                            <ThemedText type="small" themeColor="textSecondary">
                              Already carried
                            </ThemedText>
                          )}
                        </ThemedView>
                      </ThemedView>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {error && (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            )}
            {message && <ThemedText type="small">{message}</ThemedText>}

            <Pressable
              onPress={send}
              disabled={sending || selected.size === 0}
              style={({ pressed }) => [
                styles.button,
                (pressed || sending || selected.size === 0) && styles.pressed,
              ]}>
              <ThemedView type="backgroundSelected" style={styles.buttonView}>
                <ThemedText type="smallBold">{sending ? "Sending…" : "Send"}</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <ThemedView type="backgroundElement" style={styles.buttonView}>
                <ThemedText type="small">Close</ThemedText>
              </ThemedView>
            </Pressable>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
  card: {
    width: 320,
    maxWidth: "100%",
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  list: {
    maxHeight: 300,
  },
  listContent: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  disabled: {
    opacity: 0.5,
  },
  error: {
    color: "#E5484D",
  },
  button: {
    alignSelf: "stretch",
  },
  buttonView: {
    alignItems: "center",
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.4,
  },
});
