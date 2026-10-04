import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listProducts, productImageUrl, type Product } from '@/api/products';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AdminScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const theme = useTheme();

  // Asks the backend for the product list and saves it on the screen
  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await listProducts());
    } catch {
      setError('Could not reach the backend. Is it running?');
    } finally {
      setLoading(false);
    }
  }, []);

  // Runs once when the screen first opens
  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Only keep the products whose name or brand contains what was typed
  const query = search.trim().toLowerCase();
  const visibleProducts = products.filter(
    (product) =>
      product.name.toLowerCase().includes(query) ||
      (product.brand ?? '').toLowerCase().includes(query),
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">Admin</ThemedText>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search products"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
        {loading && products.length === 0 && <ActivityIndicator />}

        <FlatList
          data={visibleProducts}
          keyExtractor={(product) => String(product.product_id)}
          refreshing={loading}
          onRefresh={loadProducts}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <ProductRow product={item} />}
          ListEmptyComponent={
            !loading && !error ? (
              <ThemedText themeColor="textSecondary">
                {query ? `No products match "${search.trim()}".` : 'No products yet.'}
              </ThemedText>
            ) : null
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function ProductRow({ product }: { product: Product }) {
  const details = [product.brand, product.product_type].filter(Boolean).join(' · ');
  const price = product.price === null ? 'No price' : `$${product.price.toFixed(2)}`;
  const imageUrl = productImageUrl(product);

  return (
    <ThemedView type="backgroundElement" style={styles.row}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.thumbnail} contentFit="contain" />
      ) : (
        <ThemedView type="backgroundSelected" style={styles.thumbnail} />
      )}
      <ThemedView type="backgroundElement" style={styles.rowText}>
        <ThemedText type="smallBold">{product.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {details}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          ID {product.product_id}
          {product.rating !== null && ` · ${product.rating.toFixed(1)} rating`}
        </ThemedText>
      </ThemedView>
      <ThemedText type="smallBold">{price}</ThemedText>
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
  search: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
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
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
    backgroundColor: '#ffffff',
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});