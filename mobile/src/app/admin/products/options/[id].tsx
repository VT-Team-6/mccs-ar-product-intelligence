import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { canEditProduct, getProduct, type Product } from "@/api/products";
import {
  getAdminVariants,
  setVariantOptions,
  variantColors,
  variantSizes,
  type Variant,
  type VariantColor,
} from "@/api/variants";
import { useAuth } from "@/auth/AuthContext";
import { FeedbackNotice } from "@/components/feedback-banner";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { COLOR_PRESETS, optionsFor, sizePresetsFor } from "@/constants/variants";
import { useTheme } from "@/hooks/use-theme";
import { confirmAction } from "@/utils/confirm";

const HEX = /^#[0-9A-Fa-f]{6}$/;

// The key for one color/size combination
const comboKey = (color: string | null, size: string | null) =>
  `${(color ?? "").toLowerCase()}|${(size ?? "").toLowerCase()}`;

// Set up the colors and sizes a product comes in, e.g. /admin/products/options/12.
// Shoes get both, backpacks and headphones colors, coffee and shampoo sizes.
// Every color comes in every size unless a combination is switched off.
export default function ProductOptionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { profile } = useAuth();

  const [product, setProduct] = useState<Product | null>(null);
  const [saved, setSaved] = useState<Variant[]>([]);
  const [colors, setColors] = useState<VariantColor[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  // Combinations that don't exist, by comboKey
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [colorName, setColorName] = useState("");
  const [colorHex, setColorHex] = useState("");
  const [sizeName, setSizeName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Puts the saved options on screen
  const showSaved = (variants: Variant[]) => {
    const savedColors = variantColors(variants);
    const savedSizes = variantSizes(variants);
    const exists = new Set(variants.map((v) => comboKey(v.color, v.size)));
    const off = new Set<string>();
    if (savedColors.length && savedSizes.length) {
      for (const color of savedColors) {
        for (const size of savedSizes) {
          if (!exists.has(comboKey(color.name, size))) off.add(comboKey(color.name, size));
        }
      }
    }
    setSaved(variants);
    setColors(savedColors);
    setSizes(savedSizes);
    setSkipped(off);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProduct(Number(id)), getAdminVariants(Number(id))])
      .then(([loadedProduct, variants]) => {
        if (cancelled) return;
        setProduct(loadedProduct);
        showSaved(variants);
      })
      .catch((error: Error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const allowed = optionsFor(product?.category);
  const canEdit = product !== null && canEditProduct(profile, product);
  // Shoe sizes follow the fit (a women's 7 isn't a men's 7)
  const sizePresets = sizePresetsFor(product?.category, product?.fit);

  // Adds a size in the presets' order (6, 6.5, 7 ...); a typed size goes at the end
  const addSize = (raw: string) => {
    const size = raw.trim().replace(/\s+/g, " ");
    if (!size) return;
    if (sizes.some((s) => s.toLowerCase() === size.toLowerCase())) {
      setProblem(`${size} is already a size`);
      return;
    }
    setProblem(null);
    const rank = (s: string) => {
      const index = sizePresets.indexOf(s);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    setSizes((current) => {
      const next = [...current, size];
      return sizePresets.includes(size) ? next.sort((a, b) => rank(a) - rank(b)) : next;
    });
    setSizeName("");
  };

  const addColor = (name: string, hex: string | null) => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return;
    if (colors.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
      setProblem(`${clean} is already a color`);
      return;
    }
    if (hex && !HEX.test(hex)) {
      setProblem("Swatch colors look like #1A1A1A");
      return;
    }
    setProblem(null);
    setColors((current) => [...current, { name: clean, hex: hex || null }]);
    setColorName("");
    setColorHex("");
  };

  const toggleCombo = (color: string, size: string) =>
    setSkipped((current) => {
      const next = new Set(current);
      const key = comboKey(color, size);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // What saving would add and remove, compared with what's saved
  const plan = useMemo(() => {
    const wanted = new Set<string>();
    for (const color of colors.length ? colors.map((c) => c.name) : [null]) {
      for (const size of sizes.length ? sizes : [null]) {
        const key = comboKey(color, size);
        if ((colors.length || sizes.length) && skipped.has(key)) continue;
        wanted.add(key);
      }
    }
    const existing = new Set(saved.map((v) => comboKey(v.color, v.size)));
    const removed = saved.filter((v) => !wanted.has(comboKey(v.color, v.size)));
    const added = [...wanted].filter((key) => !existing.has(key)).length;
    return { count: wanted.size, removed, added };
  }, [colors, sizes, skipped, saved]);

  const save = async () => {
    if (saving) return;
    if (plan.count === 0) {
      setProblem("Every combination is switched off. Keep at least one.");
      return;
    }
    if (plan.removed.length > 0) {
      const names = plan.removed.map((v) => [v.color, v.size].filter(Boolean).join(" / ") || "the single version");
      const ok = await confirmAction(
        `Remove ${names.length === 1 ? names[0] : `${names.length} sizes/colors`}?`,
        "Their stock at every store is removed with them. Low-stock alerts for them are closed.",
        "Remove",
      );
      if (!ok) return;
    }
    setSaving(true);
    setProblem(null);
    setNotice(null);
    try {
      const skip = [...skipped].map((key) => {
        const [color, size] = key.split("|");
        return {
          color: colors.find((c) => c.name.toLowerCase() === color)?.name ?? null,
          size: sizes.find((s) => s.toLowerCase() === size) ?? null,
        };
      });
      const variants = await setVariantOptions(Number(id), { colors, sizes, skip });
      showSaved(variants);
      setNotice(
        plan.added > 0
          ? `Saved. New ${plan.added === 1 ? "option starts" : "options start"} at 0 in stock at each store that sells this product.`
          : "Saved.",
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const chip = (selected: boolean) => [
    styles.chip,
    { borderColor: selected ? theme.link : theme.border },
    selected && { backgroundColor: theme.backgroundSelected },
  ];

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title="Colors & sizes"
        eyebrow="Manage Products"
        subtitle={product?.name}
        fallback="/admin/products"
      />
      <View style={styles.page}>
        {loadError && <ThemedText themeColor="danger">{loadError}</ThemedText>}
        {!product && !loadError && <ActivityIndicator />}

        {product && allowed.length === 0 && (
          <ThemedText themeColor="textSecondary">
            This category doesn&apos;t come in colors or sizes.
          </ThemedText>
        )}

        {product && allowed.length > 0 && (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ThemedText themeColor="textSecondary">
              {allowed.length === 2
                ? "Add the colors and sizes this product comes in. Every color comes in every size unless you switch a combination off below."
                : allowed[0] === "color"
                  ? "Add the colors this product comes in."
                  : "Add the sizes this product comes in. Each size can have its own price and photo."}
            </ThemedText>

            {allowed.includes("color") && (
              <ThemedView type="backgroundElement" style={styles.section}>
                <ThemedText type="smallBold">Colors</ThemedText>
                {colors.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    No colors yet: the product comes in one color.
                  </ThemedText>
                ) : (
                  <View style={styles.wrap}>
                    {colors.map((color) => (
                      <View key={color.name} style={[styles.chip, styles.picked, { borderColor: theme.link }]}>
                        <Swatch hex={color.hex} />
                        <ThemedText type="smallBold">{color.name}</ThemedText>
                        <Pressable
                          onPress={() => setColors((current) => current.filter((c) => c !== color))}
                          hitSlop={8}
                          accessibilityLabel={`Remove ${color.name}`}
                          disabled={!canEdit}
                        >
                          <ThemedText type="smallBold" themeColor="danger">✕</ThemedText>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                {canEdit && (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">Tap to add:</ThemedText>
                    <View style={styles.wrap}>
                      {COLOR_PRESETS.filter(
                        (preset) => !colors.some((c) => c.name.toLowerCase() === preset.name.toLowerCase()),
                      ).map((preset) => (
                        <Pressable
                          key={preset.name}
                          onPress={() => addColor(preset.name, preset.hex)}
                          style={({ pressed }) => [chip(false), pressed && styles.pressed]}
                        >
                          <Swatch hex={preset.hex} />
                          <ThemedText type="small">{preset.name}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.addRow}>
                      <TextInput
                        value={colorName}
                        onChangeText={setColorName}
                        placeholder="Other color, e.g. Frost Green"
                        placeholderTextColor={theme.textSecondary}
                        maxLength={40}
                        style={[styles.input, styles.grow, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
                      />
                      <TextInput
                        value={colorHex}
                        onChangeText={setColorHex}
                        placeholder="#8FBFA8"
                        placeholderTextColor={theme.textSecondary}
                        autoCapitalize="characters"
                        maxLength={7}
                        style={[styles.input, styles.hex, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
                      />
                      <AppButton
                        label="Add"
                        size="small"
                        variant="secondary"
                        onPress={() => addColor(colorName, colorHex.trim() || null)}
                        disabled={!colorName.trim()}
                      />
                    </View>
                  </>
                )}
              </ThemedView>
            )}

            {allowed.includes("size") && (
              <ThemedView type="backgroundElement" style={styles.section}>
                <ThemedText type="smallBold">Sizes</ThemedText>
                {sizes.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    No sizes yet: the product comes in one size.
                  </ThemedText>
                ) : (
                  <View style={styles.wrap}>
                    {sizes.map((size) => (
                      <View key={size} style={[styles.chip, styles.picked, { borderColor: theme.link }]}>
                        <ThemedText type="smallBold">{size}</ThemedText>
                        <Pressable
                          onPress={() => setSizes((current) => current.filter((s) => s !== size))}
                          hitSlop={8}
                          accessibilityLabel={`Remove size ${size}`}
                          disabled={!canEdit}
                        >
                          <ThemedText type="smallBold" themeColor="danger">✕</ThemedText>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                {canEdit && (
                  <>
                    {sizePresets.some((preset) => !sizes.includes(preset)) && (
                      <>
                        <ThemedText type="small" themeColor="textSecondary">Tap to add:</ThemedText>
                        <View style={styles.wrap}>
                          {sizePresets
                            .filter((preset) => !sizes.includes(preset))
                            .map((preset) => (
                              <Pressable
                                key={preset}
                                onPress={() => addSize(preset)}
                                style={({ pressed }) => [chip(false), pressed && styles.pressed]}
                              >
                                <ThemedText type="small">{preset}</ThemedText>
                              </Pressable>
                            ))}
                        </View>
                      </>
                    )}
                    <View style={styles.addRow}>
                      <TextInput
                        value={sizeName}
                        onChangeText={setSizeName}
                        onSubmitEditing={() => addSize(sizeName)}
                        placeholder={product.category === "shoes" ? "Other size, e.g. 15" : "Other size, e.g. 40 oz"}
                        placeholderTextColor={theme.textSecondary}
                        maxLength={20}
                        style={[styles.input, styles.grow, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
                      />
                      <AppButton
                        label="Add"
                        size="small"
                        variant="secondary"
                        onPress={() => addSize(sizeName)}
                        disabled={!sizeName.trim()}
                      />
                    </View>
                  </>
                )}
              </ThemedView>
            )}

            {colors.length > 0 && sizes.length > 0 && (
              <ThemedView type="backgroundElement" style={styles.section}>
                <ThemedText type="smallBold">Which sizes each color comes in</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Tap a size to switch it off for that color.
                </ThemedText>
                {colors.map((color) => (
                  <View key={color.name} style={styles.comboRow}>
                    <View style={styles.comboColor}>
                      <Swatch hex={color.hex} />
                      <ThemedText type="smallBold" numberOfLines={1}>{color.name}</ThemedText>
                    </View>
                    <View style={styles.wrap}>
                      {sizes.map((size) => {
                        const on = !skipped.has(comboKey(color.name, size));
                        return (
                          <Pressable
                            key={size}
                            onPress={() => toggleCombo(color.name, size)}
                            disabled={!canEdit}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on }}
                            accessibilityLabel={`${color.name} in size ${size}`}
                            style={({ pressed }) => [chip(on), !on && styles.off, pressed && styles.pressed]}
                          >
                            <ThemedText type={on ? "smallBold" : "small"} style={!on && styles.struck}>
                              {size}
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </ThemedView>
            )}

            {problem && <FeedbackNotice kind="error" message={problem} onDismiss={() => setProblem(null)} />}
            {notice && <FeedbackNotice kind="success" message={notice} onDismiss={() => setNotice(null)} />}

            {canEdit ? (
              <View style={styles.actions}>
                <ThemedText type="small" themeColor="textSecondary">
                  {plan.count === 1 && !colors.length && !sizes.length
                    ? "One version, no options."
                    : `${plan.count} combination${plan.count === 1 ? "" : "s"}`}
                  {plan.removed.length > 0 ? ` · ${plan.removed.length} removed` : ""}
                </ThemedText>
                <AppButton label="Save colors & sizes" onPress={() => void save()} loading={saving} />
                <AppButton
                  label="Photos for each option"
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: "/admin/product-images/[id]", params: { id: String(product.product_id) } })
                  }
                />
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Only the store that added this product, or the app admin, can change its options.
              </ThemedText>
            )}
          </ScrollView>
        )}
      </View>
    </ThemedView>
  );
}

// A round dot in the color, with a ring so white shows on white
function Swatch({ hex }: { hex: string | null }) {
  const theme = useTheme();
  if (!hex) return null;
  return <View style={[styles.swatch, { backgroundColor: hex, borderColor: theme.border }]} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  page: {
    flex: 1,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  content: { gap: Spacing.three, paddingBottom: Spacing.five },
  section: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.medium },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one + Spacing.half, flexShrink: 1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two + Spacing.half,
    minHeight: 34,
  },
  picked: { gap: Spacing.two },
  off: { opacity: 0.55 },
  struck: { textDecorationLine: "line-through" },
  swatch: { width: 14, height: 14, borderRadius: 7, borderWidth: 1 },
  addRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
  },
  grow: { flex: 1, minWidth: 0 },
  hex: { width: 96 },
  comboRow: { gap: Spacing.one },
  comboColor: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  actions: { gap: Spacing.two },
  pressed: { opacity: 0.6 },
});
