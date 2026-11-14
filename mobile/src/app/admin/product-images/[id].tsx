import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  addProductImage,
  canEditProduct,
  deleteProductImage,
  getProduct,
  listProductImages,
  productImageUrl,
  uploadProductImage,
  type Product,
  type ProductImage,
} from "@/api/products";
import { useAuth } from "@/auth/AuthContext";
import { AmazonImagePicker } from "@/components/amazon-image-picker";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { confirmAction } from "@/utils/confirm";
import { imageUrlProblem } from "@/utils/product-images";

// Add or remove a product's extra photos, e.g. /admin/product-images/12.
// The main photo is not editable here: it is the product's own image_url, which
// stays the picture every card and listing shows.
export default function ManageImagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { profile } = useAuth();

  const [product, setProduct] = useState<Product | null>(null);
  const [images, setImages] = useState<ProductImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [picking, setPicking] = useState(false);

  // Reloads the product and its gallery whenever the screen is shown, so a
  // change made on the product page is reflected here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      Promise.all([getProduct(Number(id)), listProductImages(Number(id))])
        .then(([loadedProduct, loadedImages]) => {
          if (cancelled) return;
          setProduct(loadedProduct);
          setImages(loadedImages);
        })
        .catch((problem: Error) => {
          if (!cancelled) setError(problem.message);
        });
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace("/admin/products");

  // Refreshes the grid from the backend after a change, so the screen shows
  // exactly what was stored rather than what the app hoped was stored.
  const reload = async () => {
    setImages(await listProductImages(Number(id)));
  };

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await action());
      await reload();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  };

  const addByUrl = async () => {
    const problem = imageUrlProblem(url);
    if (problem) {
      setError(problem);
      return;
    }
    await run(async () => {
      await addProductImage(Number(id), url);
      setUrl("");
      return "Image added.";
    });
  };

  const pickAndUpload = async () => {
    setError(null);
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to choose a picture from your device.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      // Keeps uploads under the backend's 5 MB limit.
      quality: 0.8,
      allowsMultipleSelection: false,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    await run(async () => {
      await uploadProductImage(Number(id), {
        uri: asset.uri,
        name: asset.fileName,
        type: asset.mimeType,
        // Web fills this in; native leaves it undefined.
        file: asset.file,
      });
      return "Image uploaded.";
    });
  };

  // Adds the photo chosen from an Amazon listing, using the same picker as the
  // product form. It saves immediately: unlike the product form, this screen has
  // no "Save" step to defer it to.
  const addFromListing = async (imageUrl: string) => {
    await run(async () => {
      await addProductImage(Number(id), imageUrl);
      return "Image added.";
    });
  };

  const remove = async (image: ProductImage) => {
    const confirmed = await confirmAction(
      "Remove this image?",
      "It will no longer appear on the product page. An uploaded photo is deleted for good.",
      "Remove",
    );
    if (!confirmed) return;
    await run(async () => {
      await deleteProductImage(Number(id), image.image_id);
      return "Image removed.";
    });
  };

  const mainImage = product ? productImageUrl(product) : null;
  // Owners can change the gallery; someone who can open the product page but
  // not edit it sees the photos read-only.
  const canManage = product !== null && canEditProduct(profile, product);

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

        <ThemedText type="subtitle" style={styles.title}>
          Product images
        </ThemedText>
        {product && (
          <ThemedText type="small" themeColor="textSecondary">
            {product.name}
          </ThemedText>
        )}

        {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
        {!product && !error && <ActivityIndicator />}

        {product && (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Main image</ThemedText>
              {mainImage ? (
                <Image
                  source={{ uri: mainImage }}
                  style={[styles.mainImage, styles.whiteBackground]}
                  contentFit="contain"
                />
              ) : (
                <ThemedView type="backgroundSelected" style={styles.mainImage} />
              )}
              <ThemedText type="small" themeColor="textSecondary">
                The main image is the photo shown on cards and listings, and
                first on the product page. Change it by editing the product.
              </ThemedText>
            </ThemedView>

            <ThemedView style={styles.section}>
              <ThemedText type="smallBold">
                Extra images{images ? ` (${images.length})` : ""}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Shoppers page through these on the product page, after the main
                image.
              </ThemedText>

              {images === null && !error && <ActivityIndicator />}
              {images !== null && images.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  No extra images yet.
                </ThemedText>
              )}

              {images !== null && images.length > 0 && (
                <View style={styles.grid}>
                  {images.map((image) => (
                    <ExtraImage
                      key={image.image_id}
                      image={image}
                      onRemove={() => remove(image)}
                      disabled={busy || !canManage}
                    />
                  ))}
                </View>
              )}
            </ThemedView>

            {canManage && (
              <ThemedView type="backgroundElement" style={styles.section}>
                <ThemedText type="smallBold">Add an image</ThemedText>

                <Pressable
                  onPress={pickAndUpload}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => (pressed || busy) && styles.pressed}
                >
                  <ThemedView type="backgroundSelected" style={styles.buttonView}>
                    <ThemedText type="smallBold">
                      {busy ? "Working…" : "Upload from device"}
                    </ThemedText>
                  </ThemedView>
                </Pressable>

                <Pressable
                  onPress={() => setPicking(true)}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => (pressed || busy) && styles.pressed}
                >
                  <ThemedView type="backgroundSelected" style={styles.buttonView}>
                    <ThemedText type="smallBold">Choose Amazon image</ThemedText>
                  </ThemedView>
                </Pressable>

                <ThemedText type="small" themeColor="textSecondary">
                  Or paste a direct image link:
                </ThemedText>
                <TextInput
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://example.com/product-2.jpg"
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel="Image link"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  maxLength={500}
                  editable={!busy}
                  style={[
                    styles.input,
                    { color: theme.text, backgroundColor: theme.backgroundSelected },
                  ]}
                />
                <Pressable
                  onPress={addByUrl}
                  disabled={busy || !url.trim()}
                  accessibilityRole="button"
                  style={({ pressed }) =>
                    (pressed || busy || !url.trim()) && styles.pressed
                  }
                >
                  <ThemedView type="backgroundSelected" style={styles.buttonView}>
                    <ThemedText type="smallBold">Add link</ThemedText>
                  </ThemedView>
                </Pressable>
              </ThemedView>
            )}

            {!canManage && images !== null && (
              <ThemedText type="small" themeColor="textSecondary">
                You can see this product&apos;s images, but only the store that
                added it or the app admin can change them.
              </ThemedText>
            )}

            {busy && <ActivityIndicator />}
            {message && <ThemedText type="small">{message}</ThemedText>}
          </ScrollView>
        )}
      </SafeAreaView>

      {canManage && product && (
        <AmazonImagePicker
          visible={picking}
          productName={product.name}
          onClose={() => setPicking(false)}
          onChoose={(imageUrl) => void addFromListing(imageUrl)}
        />
      )}
    </ThemedView>
  );
}

function ExtraImage({
  image,
  onRemove,
  disabled,
}: {
  image: ProductImage;
  onRemove: () => void;
  disabled: boolean;
}) {
  const uri = productImageUrl(image);
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.cardImage, styles.whiteBackground]}
          contentFit="contain"
        />
      ) : (
        <ThemedView type="backgroundSelected" style={styles.cardImage} />
      )}
      <Pressable
        onPress={onRemove}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Remove this image"
        hitSlop={8}
        style={({ pressed }) => (pressed || disabled) && styles.pressed}
      >
        <ThemedText type="smallBold" style={styles.remove}>
          Remove
        </ThemedText>
      </Pressable>
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
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  section: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  mainImage: {
    width: "100%",
    borderRadius: Spacing.two,
    ...Platform.select({
      web: { height: 220 },
      default: { aspectRatio: 1.4 },
    }),
  },
  whiteBackground: {
    backgroundColor: "#ffffff",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  card: {
    width: 140,
    gap: Spacing.one,
    padding: Spacing.two,
    borderRadius: Spacing.two,
  },
  cardImage: {
    width: "100%",
    height: 100,
    borderRadius: Spacing.two,
  },
  remove: {
    color: "#E5484D",
  },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  buttonView: {
    alignItems: "center",
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
});
