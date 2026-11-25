import { Redirect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { getStoreVariants, setLowStockLevels, type StoreVariant } from "@/api/variants";
import { useAuth } from "@/auth/AuthContext";
import { canAccessStore } from "@/auth/store-access";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

// The iPhone number pad has no Done key; every field here shares one Done bar
const DONE_BAR = "low-stock-levels-done";

const digitsOnly = (typed: string) => typed.replace(/[^0-9]/g, "").slice(0, 5);

// Low-stock levels for one product's colors and sizes at a store.
// /admin/inventory/levels?storeId=1&productId=5&productName=...&level=3
export default function LowStockLevelsScreen() {
  const params = useLocalSearchParams<{
    storeId: string;
    storeName?: string;
    productId: string;
    productName?: string;
    level?: string;
  }>();
  const storeId = Number(params.storeId);
  const { profile, hasPermission } = useAuth();
  if (!hasPermission("manage_inventory") || !canAccessStore(profile, storeId)) {
    return <Redirect href="/admin/inventory" />;
  }
  return (
    <LowStockLevels
      storeId={storeId}
      storeName={params.storeName}
      productId={Number(params.productId)}
      productName={params.productName ?? "Product"}
      startLevel={params.level ?? ""}
    />
  );
}

type Group = { color: string | null; hex: string | null; hex2: string | null; sizes: StoreVariant[] };

// Sizes grouped under their color, in display order
function byColor(variants: StoreVariant[]): Group[] {
  const groups: Group[] = [];
  for (const variant of variants) {
    let group = groups.find((g) => g.color === variant.color);
    if (!group) {
      group = { color: variant.color, hex: variant.color_hex, hex2: variant.color_hex_2 ?? null, sizes: [] };
      groups.push(group);
    }
    group.sizes.push(variant);
  }
  return groups;
}

function LowStockLevels({
  storeId,
  storeName,
  productId,
  productName,
  startLevel,
}: {
  storeId: number;
  storeName?: string;
  productId: number;
  productName: string;
  startLevel: string;
}) {
  const theme = useTheme();
  const [variants, setVariants] = useState<StoreVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // The product's level (every size without its own uses it)
  const [productLevel, setProductLevel] = useState(startLevel);
  const [savedProductLevel, setSavedProductLevel] = useState(startLevel);
  // Each size's own level as typed; "" means it uses the product's level
  const [own, setOwn] = useState<Record<number, string>>({});
  // The "set all" box for each color
  const [colorAll, setColorAll] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback((rows: StoreVariant[]) => {
    setVariants(rows);
    setOwn(
      Object.fromEntries(
        rows.map((v) => [v.variant_id, v.own_low_stock_threshold === null ? "" : String(v.own_low_stock_threshold)]),
      ),
    );
    // A size without its own level shows the product's
    const usesProduct = rows.find((v) => v.own_low_stock_threshold === null);
    if (usesProduct) {
      setProductLevel(String(usesProduct.low_stock_threshold));
      setSavedProductLevel(String(usesProduct.low_stock_threshold));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        show(await getStoreVariants(storeId, productId));
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : "Could not load the sizes and colors.");
      } finally {
        setLoading(false);
      }
    })();
  }, [storeId, productId, show]);

  const changeOwn = (variantId: number, typed: string) => {
    setMessage(null);
    setOwn((previous) => ({ ...previous, [variantId]: digitsOnly(typed) }));
  };

  // A size using the product's level shows it in gray, which can't be edited.
  // Tapping it puts the number in the box so it can be deleted or changed;
  // leaving it unchanged puts it back to using the product's level.
  const filledOnFocus = useRef<Record<number, string>>({});
  const startEditing = (variantId: number) => {
    if ((own[variantId] ?? "") !== "" || productLevel === "") return;
    filledOnFocus.current[variantId] = productLevel;
    setOwn((previous) => ({ ...previous, [variantId]: productLevel }));
  };
  const stopEditing = (variantId: number) => {
    const filled = filledOnFocus.current[variantId];
    delete filledOnFocus.current[variantId];
    if (filled !== undefined && own[variantId] === filled) {
      setOwn((previous) => ({ ...previous, [variantId]: "" }));
    }
  };

  // Fills every size of the color with the typed number
  const setAllOfColor = (group: Group) => {
    const key = group.color ?? "";
    const value = colorAll[key] ?? "";
    if (value === "") return;
    Keyboard.dismiss();
    setMessage(null);
    setOwn((previous) => {
      const next = { ...previous };
      for (const size of group.sizes) next[size.variant_id] = value;
      return next;
    });
    setColorAll((previous) => ({ ...previous, [key]: "" }));
  };

  const resetAll = () => {
    setMessage(null);
    setOwn(Object.fromEntries(variants.map((v) => [v.variant_id, ""])));
  };

  const save = async () => {
    Keyboard.dismiss();
    setError(null);
    setMessage(null);
    if (productLevel.trim() === "") {
      setError("Enter the level for all sizes & colors.");
      return;
    }
    // Only the sizes whose own level changed
    const levels = variants
      .filter((v) => (own[v.variant_id] ?? "") !== (v.own_low_stock_threshold === null ? "" : String(v.own_low_stock_threshold)))
      .map((v) => ({
        variant_id: v.variant_id,
        low_stock_threshold: own[v.variant_id] ? Number(own[v.variant_id]) : null,
      }));
    const levelChanged = productLevel !== savedProductLevel;
    if (!levelChanged && levels.length === 0) {
      setMessage("Nothing to save.");
      return;
    }
    setSaving(true);
    try {
      const rows = await setLowStockLevels(storeId, productId, {
        ...(levelChanged ? { low_stock_threshold: Number(productLevel) } : {}),
        levels,
      });
      setSavedProductLevel(productLevel);
      show(rows);
      setMessage("Saved.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save the levels.");
    } finally {
      setSaving(false);
    }
  };

  const customCount = Object.values(own).filter((value) => value !== "").length;
  const fieldStyle = [styles.field, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }];

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={productName} eyebrow="Low stock levels" subtitle={storeName || undefined} compact />

      <ScrollView
        style={styles.edgeToEdge}
        contentContainerStyle={[styles.body, styles.edgePadding]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {loading && <ActivityIndicator />}

        {!loading && (
          <>
            <ThemedView type="backgroundElement" style={styles.card}>
              <View style={styles.allRow}>
                <View style={styles.allText}>
                  <ThemedText type="smallBold">All sizes & colors</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Low when a size has this many or fewer, unless it has its own level below.
                  </ThemedText>
                </View>
                <TextInput
                  value={productLevel}
                  onChangeText={(typed) => {
                    setMessage(null);
                    setProductLevel(digitsOnly(typed));
                  }}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  selectTextOnFocus
                  inputAccessoryViewID={Platform.OS === "ios" ? DONE_BAR : undefined}
                  accessibilityLabel="Low-stock level for all sizes and colors"
                  style={[fieldStyle, styles.boldField]}
                />
              </View>
              {customCount > 0 && (
                <Pressable onPress={resetAll} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="linkPrimary">{`Reset ${customCount} custom to this level`}</ThemedText>
                </Pressable>
              )}
            </ThemedView>

            {byColor(variants).map((group) => {
              const key = group.color ?? "";
              return (
                <ThemedView key={key || "sizes"} type="backgroundElement" style={styles.card}>
                  <View style={styles.colorRow}>
                    {group.color && group.hex && <ColorSwatch hex={group.hex} hex2={group.hex2} size={20} />}
                    <ThemedText type="smallBold" style={styles.colorName}>
                      {group.color ?? "Sizes"}
                    </ThemedText>
                    {group.sizes.length > 1 && (
                      <>
                        <TextInput
                          value={colorAll[key] ?? ""}
                          onChangeText={(typed) => setColorAll((previous) => ({ ...previous, [key]: digitsOnly(typed) }))}
                          onSubmitEditing={() => setAllOfColor(group)}
                          placeholder="#"
                          placeholderTextColor={theme.textSecondary}
                          keyboardType="number-pad"
                          returnKeyType="done"
                          inputAccessoryViewID={Platform.OS === "ios" ? DONE_BAR : undefined}
                          accessibilityLabel={`Level for every ${group.color ?? ""} size`}
                          style={fieldStyle}
                        />
                        <Pressable
                          onPress={() => setAllOfColor(group)}
                          disabled={!colorAll[key]}
                          hitSlop={8}
                          style={({ pressed }) => [!colorAll[key] && styles.dim, pressed && styles.pressed]}
                        >
                          <ThemedText type="linkPrimary">Set all</ThemedText>
                        </Pressable>
                      </>
                    )}
                  </View>

                  <View style={styles.grid}>
                    {group.sizes.map((size) => {
                      const typed = own[size.variant_id] ?? "";
                      const quantity = size.quantity ?? 0;
                      const level = typed !== "" ? Number(typed) : Number(productLevel || 0);
                      const low = quantity <= level;
                      return (
                        <View key={size.variant_id} style={styles.cell}>
                          <ThemedText type="small" style={styles.sizeLabel} numberOfLines={1}>
                            {size.size ?? size.color ?? "Level"}
                          </ThemedText>
                          <TextInput
                            value={typed}
                            onChangeText={(next) => changeOwn(size.variant_id, next)}
                            onFocus={() => startEditing(size.variant_id)}
                            onBlur={() => stopEditing(size.variant_id)}
                            // A size using the product's level shows it in gray
                            placeholder={productLevel || "–"}
                            placeholderTextColor={theme.textSecondary}
                            keyboardType="number-pad"
                            returnKeyType="done"
                            inputAccessoryViewID={Platform.OS === "ios" ? DONE_BAR : undefined}
                            accessibilityLabel={`Low-stock level for ${size.label}`}
                            style={[fieldStyle, typed !== "" && styles.boldField]}
                          />
                          <ThemedText type="small" themeColor={low ? "danger" : "textSecondary"}>
                            {`${quantity} left`}
                          </ThemedText>
                        </View>
                      );
                    })}
                  </View>
                </ThemedView>
              );
            })}

            <ThemedText type="small" themeColor="textSecondary">
              Bold numbers are a size's own level. Gray ones use the level for all sizes & colors. Clear a box to go
              back to it.
            </ThemedText>

            {error && (
              <ThemedText type="small" themeColor="danger">
                {error}
              </ThemedText>
            )}
            {message && (
              <ThemedText type="small" themeColor="success">
                {message}
              </ThemedText>
            )}
            <AppButton label="Save" onPress={save} loading={saving} />
          </>
        )}
      </ScrollView>

      {Platform.OS === "ios" && (
        <InputAccessoryView nativeID={DONE_BAR}>
          <View style={[styles.doneBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10} accessibilityRole="button">
              <ThemedText type="linkPrimary">Done</ThemedText>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // The scroll bar sits at the screen edge; the content keeps the side margins
  edgeToEdge: {
    flex: 1,
  },
  edgePadding: {
    paddingHorizontal: Spacing.four,
  },
  body: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Radius.medium,
    gap: Spacing.three,
  },
  allRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  allText: {
    flex: 1,
    gap: Spacing.half,
  },
  colorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  colorName: {
    flex: 1,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  cell: {
    width: 64,
    alignItems: "center",
    gap: Spacing.half,
  },
  sizeLabel: {
    fontWeight: "600",
  },
  field: {
    width: 56,
    height: 38,
    borderWidth: 1,
    borderRadius: Radius.small,
    textAlign: "center",
    fontSize: 16,
  },
  boldField: {
    fontWeight: "800",
  },
  dim: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.6,
  },
  doneBar: {
    alignItems: "flex-end",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
