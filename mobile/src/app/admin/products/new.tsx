import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/auth/AuthContext";
import { listStores, manageableStores, type Store } from "@/api/inventory";
import { createProduct, type Product, type ProductInput } from "@/api/products";
import { useStore } from "@/store/StoreContext";
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

  // Goes back to the list. If there's nothing to go back to, opens the list directly.
  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace("/admin/products");

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
