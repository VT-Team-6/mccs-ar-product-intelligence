import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputProps,
} from 'react-native';

import { type Product, type ProductInput } from '@/api/products';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
  const [name, setName] = useState(initial?.name ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [productType, setProductType] = useState(initial?.product_type ?? '');
  const [price, setPrice] = useState(initial?.price?.toString() ?? '');
  const [rating, setRating] = useState(initial?.rating?.toString() ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const found: string[] = [];
    const priceNumber = toNumber(price);
    const ratingNumber = toNumber(rating);

    if (!name.trim()) found.push('Name is required.');
    if (!productType.trim()) found.push('Type is required.');
    if (Number.isNaN(priceNumber) || (priceNumber !== null && priceNumber < 0)) {
      found.push('Price must be a number, 0 or higher.');
    }
    if (
      Number.isNaN(ratingNumber) ||
      (ratingNumber !== null && (ratingNumber < 0 || ratingNumber > 5))
    ) {
      found.push('Rating must be a number from 0 to 5.');
    }

    setProblems(found);
    if (found.length > 0) return;

    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        brand: brand.trim() || null,
        product_type: productType.trim(),
        price: priceNumber,
        rating: ratingNumber,
        description: description.trim() || null,
      });
    } catch (problem) {
      setProblems([problem instanceof Error ? problem.message : 'Could not save the product.']);
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="Name" required value={name} onChangeText={setName} />
        <Field label="Brand" value={brand} onChangeText={setBrand} />
        <Field label="Type" required value={productType} onChangeText={setProductType} />
        <Field
          label="Price"
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
        <Field
          label="Rating"
          value={rating}
          onChangeText={setRating}
          keyboardType="decimal-pad"
          placeholder="0 to 5"
        />
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          multiline
          style={styles.multiline}
        />

        {problems.map((problem) => (
          <ThemedText key={problem} type="small" style={styles.problem}>
            {problem}
          </ThemedText>
        ))}

        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => (pressed || saving) && styles.pressed}>
          <ThemedView type="backgroundSelected" style={styles.saveButton}>
            <ThemedText type="smallBold">{saving ? 'Saving…' : submitLabel}</ThemedText>
          </ThemedView>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Turns typed text into a number. Empty text means "no value" (null),
// and text that isn't a number gives NaN so the form can show a message.
function toNumber(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (cleaned === '') return null;
  return Number(cleaned);
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
        {required && ' *'}
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
    textAlignVertical: 'top',
  },
  problem: {
    color: '#E5484D',
  },
  saveButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.4,
  },
});