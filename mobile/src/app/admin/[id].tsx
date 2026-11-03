import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  deleteProduct,
  getProduct,
  productImageUrl,
  type Product,
} from "@/api/products";
import {
  getReviewSources,
  importProductReviews,
  type SavedReviewSource,
} from "@/api/reviews";
import { ReviewSourceSelector } from "@/components/review-source-selector";
import { QrCodeModal } from "@/components/qr-code-modal";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { confirmAction } from "@/utils/confirm";

export default function ProductScreen() {
  // The [id] in this file's name: /admin/2 gives id = "2"
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [product, setProduct] = useState<Product | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reviewSources, setReviewSources] = useState<
    SavedReviewSource[] | null
  >(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [sourceSelectorVisible, setSourceSelectorVisible] = useState(false);
  const [refreshingReviews, setRefreshingReviews] = useState(false);

  // Loads this product from the backend every time the page comes into view,
  // so it shows the new values after an edit
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
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
    }, [id]),
  );

  // Load selected review listings when this product page comes into view.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setReviewError(null);
      getReviewSources(Number(id))
        .then((sources) => {
          if (!cancelled) setReviewSources(sources);
        })
        .catch((problem: Error) => {
          if (!cancelled) setReviewError(problem.message);
        });
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  async function reloadReviewSources() {
    if (!product) return;
    try {
      setReviewSources(await getReviewSources(product.product_id));
      setReviewError(null);
    } catch (problem) {
      setReviewError(
        problem instanceof Error
          ? problem.message
          : "Could not load review sources.",
      );
    }
  }

  async function refreshReviews() {
    if (!product || refreshingReviews) return;
    setRefreshingReviews(true);
    setReviewError(null);
    setReviewMessage(null);
    try {
      const result = await importProductReviews(product.product_id);
      setReviewMessage(
        `Imported ${result.imported_reviews} reviews from ${result.source_count} listing(s).`,
      );
      await reloadReviewSources();
    } catch (problem) {
      setReviewError(
        problem instanceof Error
          ? problem.message
          : "Could not refresh reviews.",
      );
    } finally {
      setRefreshingReviews(false);
    }
  }

  // Goes back to the list. If there's nothing to go back to, opens the list directly.
  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace("/admin");

  // Asks for confirmation, deletes the product, then returns to the list
  async function handleDelete() {
    if (!product) return;
    const confirmed = await confirmAction(
      `Delete ${product.name}?`,
      "This can't be undone.",
      "Delete",
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteProduct(product.product_id);
      goBack();
    } catch {
      setError("Could not delete the product. Try again.");
      setDeleting(false);
    }
  }

  const imageUrl = product ? productImageUrl(product) : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <ThemedText type="linkPrimary">‹ Back</ThemedText>
        </Pressable>

        {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
        {!product && !error && <ActivityIndicator />}

        {product && (
          <ScrollView contentContainerStyle={styles.content}>
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={[styles.image, styles.whiteBackground]}
                contentFit="contain"
              />
            ) : (
              <ThemedView type="backgroundSelected" style={styles.image} />
            )}

            <ThemedView style={styles.section}>
              <ThemedText type="subtitle" style={styles.name}>
                {product.name}
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                {[product.brand, product.product_type]
                  .filter(Boolean)
                  .join(" · ")}
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.facts}>
              <Fact
                label="Price"
                value={
                  product.price === null
                    ? "No price"
                    : `$${product.price.toFixed(2)}`
                }
              />
              <Fact
                label="Rating"
                value={
                  product.rating === null
                    ? "No rating"
                    : product.rating.toFixed(1)
                }
              />
              <Fact label="Product ID" value={String(product.product_id)} />
            </ThemedView>

            {product.description && (
              <ThemedText>{product.description}</ThemedText>
            )}

            <ThemedView type="backgroundElement" style={styles.reviewSection}>
              <ThemedText type="smallBold">Review sources</ThemedText>
              {reviewSources === null && !reviewError ? (
                <ActivityIndicator />
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  {reviewSources === null
                    ? "Review sources unavailable"
                    : reviewSources.length === 0
                      ? "No verified review listings yet."
                      : `${reviewSources.length} approved listing(s)`}
                </ThemedText>
              )}
              {reviewError && (
                <ThemedText type="small" style={styles.reviewError}>
                  {reviewError}
                </ThemedText>
              )}
              {reviewMessage && (
                <ThemedText type="small">{reviewMessage}</ThemedText>
              )}
              <ThemedView style={styles.reviewActions}>
                <ActionButton
                  label={
                    reviewSources?.length ? "Change sources" : "Choose sources"
                  }
                  onPress={() => {
                    setReviewMessage(null);
                    setSourceSelectorVisible(true);
                  }}
                />
                {!!reviewSources?.length && (
                  <ActionButton
                    label={
                      refreshingReviews ? "Refreshing…" : "Refresh reviews"
                    }
                    onPress={refreshReviews}
                    disabled={refreshingReviews}
                  />
                )}
              </ThemedView>
            </ThemedView>

            <ThemedView style={styles.actions}>
              {/* Edit is switched on in a later step */}
              <ActionButton
                label="Edit"
                onPress={() =>
                  router.push({
                    pathname: "/admin/edit/[id]",
                    params: { id: String(product.product_id) },
                  })
                }
              />
              <ActionButton
                label="QR code"
                onPress={() => setQrVisible(true)}
              />
              <ActionButton
                label={deleting ? "Deleting…" : "Delete"}
                onPress={handleDelete}
                disabled={deleting}
                destructive
              />
            </ThemedView>
          </ScrollView>
        )}
      </SafeAreaView>

      {product && (
        <QrCodeModal
          product={product}
          visible={qrVisible}
          onClose={() => setQrVisible(false)}
        />
      )}
      {product && (
        <ReviewSourceSelector
          visible={sourceSelectorVisible}
          productId={product.product_id}
          productName={product.name}
          onClose={() => {
            setSourceSelectorVisible(false);
            void reloadReviewSources();
          }}
        />
      )}
    </ThemedView>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <ThemedView type="backgroundElement" style={styles.actionView}>
        <ThemedText
          type="smallBold"
          style={destructive && styles.destructiveText}
        >
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.fact}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
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
    // No tab bar underneath: admin is pushed over the tabs
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  pressed: {
    opacity: 0.4,
  },
  reviewSection: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  reviewActions: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  reviewError: {
    color: "#E5484D",
  },
  // The row of buttons under the description. It scrolls with the rest of the page.
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
  actionView: {
    alignItems: "center",
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  // Red text for buttons that remove something
  destructiveText: {
    color: "#E5484D",
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  image: {
    width: "100%",
    borderRadius: Spacing.three,
    // On a phone the image keeps its shape. In a browser the window is much wider,
    // so the image gets a fixed height there to leave room for the details below.
    ...Platform.select({
      web: { height: 300 },
      default: { aspectRatio: 1.4 },
    }),
  },
  // Product photos have see-through backgrounds, so they sit on white in both light and dark mode
  whiteBackground: {
    backgroundColor: "#ffffff",
  },
  section: {
    gap: Spacing.one,
  },
  name: {
    fontSize: 26,
    lineHeight: 32,
  },
  facts: {
    flexDirection: "row",
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  fact: {
    flex: 1,
    gap: Spacing.half,
  },
});
