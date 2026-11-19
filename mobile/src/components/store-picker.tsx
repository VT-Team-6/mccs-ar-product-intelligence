import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { type Store } from "@/api/inventory";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type Props = {
  stores: Store[];
  storeId: number | null;
  onChange: (storeId: number) => void;
  // Unread updates per store id, shown as "(3 new)" (Reorders only)
  unreadByStore?: Record<string, number>;
};

// The store dropdown for staff who work at more than one store (Inventory and
// Reorders). The chosen store shows with the arrow on the right; open it to see
// every store with its address. Renders nothing for staff with one store.
export function StorePicker({ stores, storeId, onChange, unreadByStore = {} }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (stores.length < 2) return null;

  const current = stores.find((store) => store.store_id === storeId);
  const newAt = (id: number) => unreadByStore[id] ?? 0;
  const newElsewhere = stores
    .filter((store) => store.store_id !== storeId)
    .reduce((total, store) => total + newAt(store.store_id), 0);

  return (
    <ThemedView type="card" style={[styles.box, { borderColor: theme.border }]}>
      <Pressable
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityLabel={`Store: ${current?.name ?? "none"}. Change store`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.text}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {current?.name ?? "Choose a store"}
          </ThemedText>
          {!open && newElsewhere > 0 && (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {`${newElsewhere} new at your other store${stores.length > 2 ? "s" : ""}`}
            </ThemedText>
          )}
        </View>
        <ThemedText themeColor="link" style={styles.arrow}>
          {open ? "▴" : "▾"}
        </ThemedText>
      </Pressable>

      {open &&
        stores.map((store) => {
          const chosen = store.store_id === storeId;
          return (
            <Pressable
              key={store.store_id}
              onPress={() => {
                onChange(store.store_id);
                setOpen(false);
              }}
              style={({ pressed }) => [
                styles.option,
                { borderTopColor: theme.border },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.text}>
                <ThemedText type={chosen ? "smallBold" : "small"}>
                  {store.name}
                  {newAt(store.store_id) > 0 && (
                    <ThemedText type="smallBold" style={{ color: theme.danger }}>
                      {`  (${newAt(store.store_id)} new)`}
                    </ThemedText>
                  )}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {store.address}
                </ThemedText>
              </View>
              {chosen && (
                <ThemedText themeColor="link" type="smallBold">
                  ✓
                </ThemedText>
              )}
            </Pressable>
          );
        })}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two + Spacing.half,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two + Spacing.half,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  arrow: {
    fontSize: 14,
  },
  pressed: {
    opacity: 0.6,
  },
});
