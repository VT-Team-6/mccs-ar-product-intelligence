import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { productImageUrl } from '@/api/products';
import { AmazonImagePicker, ImagePreview } from '@/components/amazon-image-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { imageUrlProblem } from '@/utils/product-images';

type Props = {
  productName: string;
  value: string;
  onChange: (url: string) => void;
  onVerified: (url: string) => void;
  disabled?: boolean;
};

// The product form's featured image: a link the admin can paste, preview, or pick
// from a specific Amazon listing.
export function ProductImagePicker({ productName, value, onChange, onVerified, disabled = false }: Props) {
  const theme = useTheme();
  const [previewUrl, setPreviewUrl] = useState(value.trim());
  const [visible, setVisible] = useState(false);
  const [selectedListing, setSelectedListing] = useState<{ id: string; url: string } | null>(null);
  const currentUrl = value.trim();
  const problem = imageUrlProblem(currentUrl);
  const previewCurrent = currentUrl && previewUrl === currentUrl && !problem;

  function choose(url: string, listingId: string) {
    onChange(url);
    onVerified(url); // The form enables saving only after the image has loaded.
    setPreviewUrl(url);
    setSelectedListing({ id: listingId, url });
  }

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="smallBold">Product image</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Paste a direct image link or choose the photo from a specific Amazon listing.
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="https://example.com/product.jpg"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Product image URL"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        maxLength={500}
        editable={!disabled}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      {problem && <ThemedText type="small" style={styles.error}>{problem}</ThemedText>}
      <View style={styles.actions}>
        <Button label="Preview link" onPress={() => setPreviewUrl(currentUrl)} disabled={disabled || !currentUrl || !!problem} />
        <Button label="Choose Amazon image" onPress={() => setVisible(true)} disabled={disabled} />
        {!!currentUrl && <Button label="Remove image" onPress={() => { onChange(''); setPreviewUrl(''); }} disabled={disabled} />}
      </View>
      {previewCurrent ? (
        <ImagePreview key={currentUrl} uri={productImageUrl({ image_url: currentUrl })!} onLoaded={() => onVerified(currentUrl)} />
      ) : (
        <ThemedView type="backgroundElement" style={styles.placeholder}>
          <ThemedText type="small" themeColor="textSecondary">
            {currentUrl ? 'Preview this link before saving.' : 'No image selected'}
          </ThemedText>
        </ThemedView>
      )}
      {selectedListing?.url === currentUrl && (
        <ThemedText type="small" themeColor="textSecondary">Image from Amazon listing {selectedListing.id}.</ThemedText>
      )}
      <ThemedText type="small" themeColor="textSecondary">
        Save the product to apply your image choice. Choosing an image does not change its review sources.
      </ThemedText>

      <AmazonImagePicker
        visible={visible}
        productName={productName}
        onClose={() => setVisible(false)}
        onChoose={choose}
      />
    </ThemedView>
  );
}

function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dimmed]}>
      <ThemedText type="linkPrimary">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  input: { fontSize: 16, paddingVertical: Spacing.two + Spacing.half, paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.one },
  dimmed: { opacity: .4 },
  placeholder: { minHeight: 100, alignItems: 'center', justifyContent: 'center', borderRadius: Spacing.two },
  error: { color: '#E5484D' },
});
