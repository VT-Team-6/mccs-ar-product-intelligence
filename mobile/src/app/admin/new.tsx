import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createProduct, type Product, type ProductInput } from "@/api/products";
import { getReviewSources } from "@/api/reviews";
import { ReviewSourceSelector } from "@/components/review-source-selector";
import { ProductForm } from "@/components/product-form";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";

export default function AddProductScreen() {
  const router = useRouter();
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null);
  const [reviewSetupVisible, setReviewSetupVisible] = useState(false);

  // Goes back to the list. If there's nothing to go back to, opens the list directly.
  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace("/admin");

  function finishReviewSetup() {
    if (!createdProduct) return;
    setReviewSetupVisible(false);
    router.replace({
      pathname: "/admin/[id]",
      params: { id: String(createdProduct.product_id) },
    });
  }

  async function handleCreate(values: ProductInput) {
    const created = await createProduct(values);
    setCreatedProduct(created);

    // The product already exists: a review-source error must not re-submit the form.
    try {
      const sources = await getReviewSources(created.product_id);
      if (sources.length > 0) {
        router.replace({
          pathname: "/admin/[id]",
          params: { id: String(created.product_id) },
        });
        return;
      }
    } catch {
      // The selector can show the loading error and offer a retry or Skip.
    }
    setReviewSetupVisible(true);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <ThemedText type="linkPrimary">‹ Cancel</ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>
          Add product
        </ThemedText>

        <ProductForm submitLabel="Add product" onSubmit={handleCreate} />
      </SafeAreaView>

      {createdProduct && (
        <ReviewSourceSelector
          visible={reviewSetupVisible}
          productId={createdProduct.product_id}
          productName={createdProduct.name}
          onClose={finishReviewSetup}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    flexDirection: "row",
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    // On web the tab bar sits at the top, so leave room for it
    paddingTop:
      Platform.OS === "web" ? Spacing.six + Spacing.four : Spacing.three,
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
