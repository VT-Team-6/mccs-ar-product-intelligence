import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getProduct, updateProduct, type Product } from '@/api/products';
import { ProductForm } from '@/components/product-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function EditProductScreen() {
  // /admin/edit/2 gives id = "2"
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loads the product so the form can start with its current values
  useEffect(() => {
    let cancelled = false;
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

  // Goes back to the product page. If there's nothing to go back to, opens the list.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/admin'));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={goBack} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="linkPrimary">‹ Cancel</ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>
          Edit product
        </ThemedText>

        {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
        {!product && !error && <ActivityIndicator />}

        {/* The form is only shown once the product has loaded, so its fields start filled in */}
        {product && (
          <ProductForm
            initial={product}
            submitLabel="Save changes"
            onSubmit={async (values) => {
              await updateProduct(product.product_id, values);
              goBack();
            }}
          />
        )}
      </SafeAreaView>
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
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
  },
  pressed: {
    opacity: 0.4,
  },
});