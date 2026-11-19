import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";

import { type StoreBuyer } from "@/api/inventory";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

// "keep" leaves each product's buyer as it is (bulk editor only), null means no buyer
export type BuyerChoice = number | null | "keep";

type Props = {
  buyers: StoreBuyer[];
  value: BuyerChoice;
  onChange: (value: BuyerChoice) => void;
  allowKeep?: boolean;
};

function label(value: BuyerChoice, buyers: StoreBuyer[]): string {
  if (value === "keep") return "Don't change";
  if (value === null) return "No buyer";
  return buyers.find((buyer) => buyer.user_id === value)?.email ?? "No buyer";
}

// A small dropdown of the store's buyers
export function BuyerPicker({ buyers, value, onChange, allowKeep = false }: Props) {
  const [open, setOpen] = useState(false);
  const choices: BuyerChoice[] = [
    ...(allowKeep ? (["keep"] as const) : []),
    null,
    ...buyers.map((buyer) => buyer.user_id),
  ];

  return (
    <ThemedView type="backgroundElement" style={styles.box}>
      <Pressable onPress={() => setOpen((was) => !was)} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedText type="small">{`${label(value, buyers)}  ${open ? "▴" : "▾"}`}</ThemedText>
      </Pressable>
      {open &&
        choices.map((choice) => (
          <Pressable
            key={String(choice)}
            onPress={() => {
              onChange(choice);
              setOpen(false);
            }}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <ThemedText type={choice === value ? "smallBold" : "small"}>
              {`${choice === value ? "✓ " : ""}${label(choice, buyers)}`}
            </ThemedText>
          </Pressable>
        ))}
      {open && buyers.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No buyers at this store yet. Add one from Manage Staff.
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  box: {
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});
