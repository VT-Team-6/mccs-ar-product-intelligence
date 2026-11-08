import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputProps,
} from "react-native";

import { type Product, type ProductInput } from "@/api/products";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ProductImagePicker } from "@/components/product-image-picker";
import { BottomTabInset, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { imageUrlProblem } from "@/utils/product-images";

type Props = {
  // When editing, the product whose values fill in the form. Left out when adding.
  initial?: Product;
  submitLabel: string;
  // Saves the values. If it throws an error, the form stays open and shows the message.
  onSubmit: (values: ProductInput) => Promise<void>;
};

// The form used for both adding and editing a product
export function ProductForm({ initial, submitLabel, onSubmit }: Props) {
  // Every field is kept as text while typing, and turned into the right type on Save
  const [name, setName] = useState(initial?.name ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [productType, setProductType] = useState(initial?.product_type ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [verifiedImageUrl, setVerifiedImageUrl] = useState(initial?.image_url ?? "");

  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const found: string[] = [];

    if (!name.trim()) found.push("Name is required.");
    if (!productType.trim()) found.push("Type is required.");
    const imageProblem = imageUrlProblem(imageUrl);
    if (imageProblem) found.push(imageProblem);
    else if (imageUrl.trim() && imageUrl.trim() !== verifiedImageUrl) {
      found.push("Preview the image link and wait for it to load before saving, or remove the image.");
    }

    setProblems(found);
    if (found.length > 0) return;

    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        brand: brand.trim() || null,
        product_type: productType.trim(),
        description: description.trim() || null,
        image_url: imageUrl.trim() || null,
      });
    } catch (problem) {
      setProblems([
        problem instanceof Error
          ? problem.message
          : "Could not save the product.",
      ]);
      setSaving(false);
    }
  }

  return (
    // iOS makes room for the keyboard and scrolls the tapped field into view.
    // Swiping down on the form hides the keyboard (the number pad has no Done key).
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.form}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
    >
      <Field label="Name" required value={name} onChangeText={setName} />
      <Field label="Brand" value={brand} onChangeText={setBrand} />
      <Field
        label="Type"
        required
        value={productType}
        onChangeText={setProductType}
      />
      {/* Price is not a product field: each store sets its own, in Manage
          Inventory/Stock. */}
      <ThemedText type="small" themeColor="textSecondary">
        Prices are managed per store. Set this product&apos;s price and stock in
        Manage Inventory/Stock.
      </ThemedText>
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        style={styles.multiline}
      />

      <ProductImagePicker
        productName={name}
        value={imageUrl}
        onChange={setImageUrl}
        onVerified={setVerifiedImageUrl}
        disabled={saving}
      />

      {problems.map((problem) => (
        <ThemedText key={problem} type="small" style={styles.problem}>
          {problem}
        </ThemedText>
      ))}

      <Pressable
        onPress={handleSave}
        disabled={saving}
        style={({ pressed }) => (pressed || saving) && styles.pressed}
      >
        <ThemedView type="backgroundSelected" style={styles.saveButton}>
          <ThemedText type="smallBold">
            {saving ? "Saving…" : submitLabel}
          </ThemedText>
        </ThemedView>
      </Pressable>
    </ScrollView>
  );
}

function Field({
  label,
  required = false,
  style,
  ...inputProps
}: TextInputProps & { label: string; required?: boolean }) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
        {required && " *"}
      </ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement },
          style,
        ]}
        {...inputProps}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  form: {
    gap: Spacing.three,
    // Room at the end of the form so the last button can scroll clear of the tabs
    paddingBottom: BottomTabInset + Spacing.four,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  problem: {
    color: "#E5484D",
  },
  saveButton: {
    alignItems: "center",
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.4,
  },
});
