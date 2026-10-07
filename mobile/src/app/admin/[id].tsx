import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteProduct, getProduct, productImageUrl, type Product } from '@/api/products';
import { QrCodeModal } from '@/components/qr-code-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { confirmAction } from '@/utils/confirm';

export default function ProductScreen() {
  // The [id] in this file's name: /admin/2 gives id = "2"
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [product, setProduct] = useState<Product | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Loads this product from the backend when the page opens
  useEffect(() => {
    let cancelled = false;
    setProduct(null);
    setError(null);
    getProduct(Number(id))
      .then((loaded) => {
        if (!cancelled) setProduct(loaded);
      })
      .catch((problem: Error) => {
        if (!cancelled) setError(problem.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Goes back to the list. If there's nothing to go back to, opens the list directly.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/admin'));

  // Asks for confirmation, deletes the product, then returns to the list
  async function handleDelete() {
    if (!product) return;
    const confirmed = await confirmAction(
      `Delete ${product.name}?`,
      "This can't be undone.",
      'Delete',
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteProduct(product.product_id);
      goBack();
    } catch {
      setError('Could not delete the product. Try again.');
      setDeleting(false);
    }
  }

  const imageUrl = product ? productImageUrl(product) : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={goBack} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="linkPrimary">‹ Back</ThemedText>
        </Pressable>

        {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
        {!product && !error && <ActivityIndicator />}

        {product && (
          <ScrollView contentContainerStyle={styles.content}>
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={[styles.image, styles.whiteBackground]}
                contentFit="contain"
              />
            ) : (
              <ThemedView type="backgroundSelected" style={styles.image} />
            )}

            <ThemedView style={styles.section}>
              <ThemedText type="subtitle" style={styles.name}>
                {product.name}
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                {[product.brand, product.product_type].filter(Boolean).join(' · ')}
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.facts}>
              <Fact
                label="Price"
                value={product.price === null ? 'No price' : `$${product.price.toFixed(2)}`}
              />
              <Fact
                label="Rating"
                value={product.rating === null ? 'No rating' : product.rating.toFixed(1)}
              />
              <Fact label="Product ID" value={String(product.product_id)} />
            </ThemedView>

            {product.description && <ThemedText>{product.description}</ThemedText>}

            <ThemedView style={styles.actions}>
              {/* Edit is switched on in a later step */}
              <ActionButton label="Edit" disabled />
              <ActionButton label="QR code" onPress={() => setQrVisible(true)} />
              <ActionButton
                label={deleting ? 'Deleting…' : 'Delete'}
                onPress={handleDelete}
                disabled={deleting}
                destructive
              />
            </ThemedView>
          </ScrollView>
        )}
      </SafeAreaView>

      {product && (
        <QrCodeModal product={product} visible={qrVisible} onClose={() => setQrVisible(false)} />
      )}
    </ThemedView>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, (pressed || disabled) && styles.pressed]}>
      <ThemedView type="backgroundElement" style={styles.actionView}>
        <ThemedText type="smallBold" style={destructive && styles.destructiveText}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.fact}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    // On web the tab bar sits at the top, so leave room for it
    paddingTop: Platform.OS === 'web' ? Spacing.six + Spacing.four : Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  pressed: {
    opacity: 0.4,
  },
  // The row of buttons under the description. It scrolls with the rest of the page.
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
  actionView: {
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  // Red text for buttons that remove something
  destructiveText: {
    color: '#E5484D',
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  image: {
    width: '100%',
    aspectRatio: 1.4,
    borderRadius: Spacing.three,
  },
  // Product photos have see-through backgrounds, so they sit on white in both light and dark mode
  whiteBackground: {
    backgroundColor: '#ffffff',
  },
  section: {
    gap: Spacing.one,
  },
  name: {
    fontSize: 26,
    lineHeight: 32,
  },
  facts: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  fact: {
    flex: 1,
    gap: Spacing.half,
  },
});