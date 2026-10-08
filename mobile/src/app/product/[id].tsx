import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getShopperProduct, productImageUrl, type Product } from '@/api/products';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

export default function ShopperProductScreen() {
  // The [id] in this file's name: /product/2 gives id = "2"
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loads this product from the shopper endpoint when the page opens
  useEffect(() => {
    let cancelled = false;
    setProduct(null);
    setError(null);
    getShopperProduct(Number(id))
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

  // Goes back to the page the shopper came from, such as the search results.
  // On the web, the browser's own history remembers that page. If there is
  // nothing to go back to, opens the home page.
  const goBack = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

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
                value={product.rating === null ? 'No rating' : `${product.rating.toFixed(1)} / 5`}
              />
            </ThemedView>

            {product.description && <ThemedText>{product.description}</ThemedText>}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
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
    gap: Spacing.two,
  },
  fact: {
    flex: 1,
    gap: Spacing.half,
  },
});