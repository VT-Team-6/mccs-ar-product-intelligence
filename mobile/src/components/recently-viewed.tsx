import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { listProductHistory, type MyProduct } from "@/api/me";
import { productImageUrl } from "@/api/products";
import { useAuth } from "@/auth/AuthContext";
import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

// A row of the signed-in shopper's recently viewed products, newest first, with
// "See all" opening History. Used on Home and the search screen. Shows nothing
// when signed out or before anything has been viewed.
// "from" is the page a product's Back returns to; "limit" is how many products
// show; "size" is each photo's width and height.
export function RecentlyViewed({
  from,
  limit = 10,
  size = 96,
}: {
  from: string;
  limit?: number;
  size?: number;
}) {
  const router = useRouter();
  const theme = useTheme();
  const { profile } = useAuth();
  const [viewed, setViewed] = useState<MyProduct[]>([]);

  // Refreshes each time the screen shows, so a product just opened comes first
  useFocusEffect(
    useCallback(() => {
      if (!profile) {
        setViewed([]);
        return;
      }
      let cancelled = false;
      listProductHistory({ limit: 40 })
        .then((page) => {
          if (cancelled) return;
          // History repeats a product each time it's opened; show each once
          const seen = new Set<number>();
          const products: MyProduct[] = [];
          for (const item of page.items) {
            if (seen.has(item.product.product_id)) continue;
            seen.add(item.product.product_id);
            products.push(item.product);
            if (products.length === limit) break;
          }
          setViewed(products);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [profile, limit]),
  );

  if (viewed.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.top}>
        <ThemedText style={styles.title}>Recently viewed</ThemedText>
        <Pressable onPress={() => router.push("/products/history" as Href)} hitSlop={8}>
          <ThemedText type="linkPrimary">See all</ThemedText>
        </Pressable>
      </View>
      {/* Scrolls edge to edge, so photos slide off the side of the screen */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.edgeToEdge}
        contentContainerStyle={styles.row}
      >
        {viewed.map((product) => {
          const image = productImageUrl(product);
          return (
            <Pressable
              key={product.product_id}
              onPress={() =>
                router.push(`/product/${product.product_id}?from=${encodeURIComponent(from)}` as Href)
              }
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
    gap: Spacing.three,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
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
