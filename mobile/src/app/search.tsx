import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { productImageUrl, searchProducts, type Product } from '@/api/products';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

export default function SearchResultsScreen() {
  // The text after "?q=" in the address: /search?q=boot gives q = "boot"
  const { q } = useLocalSearchParams<{ q?: string }>();
  const query = (q ?? '').trim();

  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  // Runs the search whenever the search text changes
  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchProducts(query)
      .then((found) => {
        if (!cancelled) setResults(found);
      })
      .catch(() => {
        // Error messages are added in task 4.4
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">Search results</ThemedText>
        {query !== '' && (
          <ThemedText themeColor="textSecondary">{`Showing results for "${query}"`}</ThemedText>
        )}

        {loading && <ActivityIndicator />}

        <FlatList
          data={results}
          keyExtractor={(product) => String(product.product_id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ResultRow product={item} />}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function ResultRow({ product }: { product: Product }) {
  const router = useRouter();
  const details = [product.brand, product.product_type].filter(Boolean).join(' · ');
  const price = product.price === null ? 'No price' : `$${product.price.toFixed(2)}`;
  const imageUrl = productImageUrl(product);

  // Opens the product details page, e.g. /product/2
  const openProduct = () => router.push(`/product/${product.product_id}` as Href);

  return (
    <Pressable onPress={openProduct} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.row}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={[styles.thumbnail, styles.whiteBackground]}
            contentFit="contain"
          />
        ) : (
          <ThemedView type="backgroundSelected" style={styles.thumbnail} />
        )}
        <ThemedView type="backgroundElement" style={styles.rowText}>
          <ThemedText type="smallBold">{product.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {details}
          </ThemedText>
          {product.rating !== null && (
            <ThemedText type="small" themeColor="textSecondary">
              {`${product.rating.toFixed(1)} rating`}
            </ThemedText>
          )}
        </ThemedView>
        <ThemedText type="smallBold">{price}</ThemedText>
      </ThemedView>
    </Pressable>
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
  list: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
  },
  // Product photos have see-through backgrounds, so they sit on white in both light and dark mode
  whiteBackground: {
    backgroundColor: '#ffffff',
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});