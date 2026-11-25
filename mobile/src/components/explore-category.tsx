import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { productImageUrl, searchProducts, type Product, type ProductCategory } from "@/api/products";
import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useStore } from "@/store/StoreContext";

// A row of a category's products (e.g. "Explore shoes") for Home when there's
// no history to show, in the same style as Recently viewed. "See more" opens
// search with that category's filter on.
export function ExploreCategory({
  category,
  title,
  from,
  limit = 7,
  size = 88,
  picks = [],
}: {
  category: ProductCategory;
  // What it's called, e.g. "shoes", searched for and shown as "Explore shoes"
  title: string;
  from: string;
  limit?: number;
  size?: number;
  // Product names to show, in this order; the rest of the row fills from the category
  picks?: string[];
}) {
  const router = useRouter();
  const theme = useTheme();
  const { store } = useStore();
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    let cancelled = false;
    searchProducts(title, store?.store_id)
      .then((found) => {
        if (cancelled) return;
        const inCategory = found.filter((p) => p.category === category);
        const picked = picks
          .map((name) => inCategory.find((p) => p.name === name))
          .filter((p): p is Product => !!p);
        const rest = inCategory.filter((p) => !picked.includes(p));
        setProducts([...picked, ...rest].slice(0, limit));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // picks is a fixed list per row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, title, limit, store?.store_id]);

  if (products.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.top}>
        <ThemedText style={styles.title}>{`Explore ${title}`}</ThemedText>
        <Pressable
          onPress={() =>
            router.push(`/find?q=${encodeURIComponent(title)}&category=${category}` as Href)
          }
          hitSlop={8}
        >
          <ThemedText type="linkPrimary">See more</ThemedText>
        </Pressable>
      </View>
      {/* Scrolls edge to edge, so photos slide off the side of the screen */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.edgeToEdge} contentContainerStyle={styles.row}>
        {products.map((product) => {
          const image = productImageUrl(product);
          return (
            <Pressable
              key={product.product_id}
              onPress={() => router.push(`/product/${product.product_id}?from=${encodeURIComponent(from)}` as Href)}
              accessibilityRole="button"
              accessibilityLabel={product.name}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View style={[styles.card, { width: size, height: size, borderColor: theme.border }]}>
                {image ? (
                  <Image source={{ uri: image }} style={styles.image} resizeMode="contain" />
                ) : (
                  <ThemedText type="small" numberOfLines={3} style={styles.name}>
                    {product.name}
                  </ThemedText>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
  },
  edgeToEdge: {
    marginHorizontal: -Spacing.four,
  },
  row: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  // Product photos sit on white in both modes, since they're shot on white
  card: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: Spacing.one,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  name: {
    textAlign: "center",
    color: "#60646C",
  },
  pressed: {
    opacity: 0.6,
  },
});
