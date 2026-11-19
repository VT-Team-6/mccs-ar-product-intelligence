import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "@/auth/AuthContext";
import { listStores, manageableStores, type Store } from "@/api/inventory";
import { createProduct, type Product, type ProductInput } from "@/api/products";
import { useStore } from "@/store/StoreContext";
import { getReviewSources } from "@/api/reviews";
import { ReviewSourceSelector } from "@/components/review-source-selector";
import { ProductForm } from "@/components/product-form";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Spacing } from "@/constants/theme";

export default function AddProductScreen() {
  const router = useRouter();
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null);
  const [reviewSetupVisible, setReviewSetupVisible] = useState(false);
  const { profile, hasPermission } = useAuth();
  const { store: shoppingAt } = useStore();

  // The app admin adds MCCS catalog products with no owner. A store admin adds
  // products for one of their stores: that store owns it and it starts pending there.
  const forStore = !hasPermission("manage_products");
  const [myStores, setMyStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);

  useEffect(() => {
    if (!forStore) return;
    listStores()
      .then((all) => {
        const mine = manageableStores(all, profile);
        setMyStores(mine);
        // Start with the store they're currently at, if it's one of theirs
        setStoreId(
          mine.find((s) => s.store_id === shoppingAt?.store_id)?.store_id ??
            mine[0]?.store_id ??
            null,
        );
      })
      .catch(() => setMyStores([]));
  }, [forStore, profile, shoppingAt?.store_id]);

  function finishReviewSetup() {
    if (!createdProduct) return;
    setReviewSetupVisible(false);
    router.replace({
      pathname: "/admin/products/[id]",
      params: { id: String(createdProduct.product_id) },
    });
  }

  async function handleCreate(values: ProductInput) {
    if (forStore && storeId === null) {
      throw new Error("Choose the store this product is for.");
    }
    const created = await createProduct(
      forStore ? { ...values, store_id: storeId } : values,
    );
    setCreatedProduct(created);

    if (!hasPermission("aggregate_reviews")) {
      router.replace({ pathname: "/admin/products/[id]", params: { id: String(created.product_id) } });
      return;
    }

    // The product already exists: a review-source error must not re-submit the form.
    try {
      const sources = await getReviewSources(created.product_id);
      if (sources.length > 0) {
        router.replace({
          pathname: "/admin/products/[id]",
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
      <ScreenHeader title="Add product" eyebrow="Manage Products" fallback="/admin/products" />
      <View style={styles.safeArea}>

        {forStore && myStores.length === 1 && (
          <ThemedText themeColor="textSecondary">
            For {myStores[0].name}. It will wait in its Pending tab for a price.
          </ThemedText>
        )}
        {forStore && myStores.length > 1 && (
          <ThemedView style={styles.stores}>
            <ThemedText type="small" themeColor="textSecondary">
              Which store is this for?
            </ThemedText>
            <ThemedView style={styles.storeChoices}>
              {myStores.map((s) => (
                <Pressable
                  key={s.store_id}
                  onPress={() => setStoreId(s.store_id)}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <ThemedView
                    type={
                      s.store_id === storeId
                        ? "backgroundSelected"
                        : "backgroundElement"
                    }
                    style={styles.storeChoice}
                  >
                    <ThemedText type="smallBold">{s.name}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>
          </ThemedView>
        )}

        <ProductForm submitLabel="Add product" onSubmit={handleCreate} />
      </View>

      {createdProduct && hasPermission("aggregate_reviews") && (
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
  stores: {
    gap: Spacing.one,
  },
  storeChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  storeChoice: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
});
