import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listProducts, productImageUrl, type Product } from "@/api/products";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { AppButton } from "@/components/ui/app-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

// Manage Products: every product, searchable, with + Add for a new one.
export default function ManageProductsScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Asks the backend for the product list and saves it on the screen
  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await listProducts());
    } catch {
      setError("Could not reach the backend. Is it running?");
    } finally {
      setLoading(false);
    }
  }, []);

  // Runs when the admin pulls the list down. Only this shows the pull-down spinner.
  const refresh = async () => {
    setRefreshing(true);
    await loadProducts();
    setRefreshing(false);
  };

  // Runs every time this screen comes into view, so the list is up to date
  // after a product is added, edited, or deleted
  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [loadProducts]),
  );

  // Only keep the products whose name or brand contains what was typed
  const query = search.trim().toLowerCase();
  const visibleProducts = products.filter(
    (product) =>
      product.name.toLowerCase().includes(query) ||
      (product.brand ?? "").toLowerCase().includes(query),
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title="Manage Products"
        eyebrow="Management"
        fallback="/manage"
        backLabel="Management"
      />
      <View style={styles.body}>
        <View style={styles.searchRow}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[
              styles.search,
              { color: theme.text, backgroundColor: theme.backgroundElement },
            ]}
          />
          <AppButton
            label="+ Add"
            size="small"
            onPress={() => router.push("/admin/products/new")}
          />
        </View>

        {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
        {loading && products.length === 0 && <ActivityIndicator />}

        <FlatList
          data={visibleProducts}
          keyExtractor={(product) => String(product.product_id)}
          refreshing={refreshing}
          onRefresh={refresh}
          style={styles.edgeToEdge}
          contentContainerStyle={[[
            styles.list,
            { paddingBottom: insets.bottom + Spacing.three },
          ], styles.edgePadding]}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <ProductRow product={item} />}
          ListEmptyComponent={
            !loading && !error ? (
              <ThemedText themeColor="textSecondary">
                {query
                  ? `No products match "${search.trim()}".`
                  : "No products yet."}
              </ThemedText>
            ) : null
          }
        />
      </View>
    </ThemedView>
  );
}

function ProductRow({ product }: { product: Product }) {
  const details = [product.brand, product.product_type]
    .filter(Boolean)
    .join(" · ");
  const imageUrl = productImageUrl(product);
  const router = useRouter();
  const theme = useTheme();

  // Opens this product's page, e.g. /admin/2
  const openProduct = () =>
    router.push({
      pathname: "/admin/products/[id]",
      params: { id: String(product.product_id) },
    });

  return (
    <Pressable
      onPress={openProduct}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView
        type="card"
        style={[styles.row, { borderColor: theme.border }]}
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={[styles.thumbnail, styles.whiteBackground]}
            contentFit="contain"
          />
        ) : (
          <ThemedView type="backgroundSelected" style={styles.thumbnail} />
        )}
        <ThemedView type="card" style={styles.rowText}>
          <ThemedText type="smallBold">{product.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {details}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ID {product.product_id}
            {product.rating !== null &&
              ` · ${product.rating.toFixed(1)} rating`}
          </ThemedText>
        </ThemedView>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Lists reach the screen edges so the scroll bar sits at the edge, while
  // their content keeps the page's side margins
  edgeToEdge: {
    marginHorizontal: -Spacing.four,
  },
  edgePadding: {
    paddingHorizontal: Spacing.four,
  },
  container: {
    flex: 1,
  },
  // The page content under the navy band, centered on wide screens
  body: {
    flex: 1,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  search: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  list: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
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
    backgroundColor: "#ffffff",
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
