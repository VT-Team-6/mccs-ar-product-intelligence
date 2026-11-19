import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { getProduct, updateProduct, type Product } from "@/api/products";
import { ProductForm } from "@/components/product-form";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Spacing } from "@/constants/theme";

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
  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace("/admin/products");

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title="Edit product" eyebrow="Manage Products" fallback="/admin/products" />
      <View style={styles.safeArea}>

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
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
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
