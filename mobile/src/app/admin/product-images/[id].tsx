import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
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
import { FailureDialog, type Failure } from "@/components/failure-dialog";
import { ActionProgress, FeedbackNotice } from "@/components/feedback-banner";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [picking, setPicking] = useState(false);
  // True while an action is running. `pending` drives the UI, but this ref is
  // what the guards read: two quick taps would both see the same render's
  // `pending`, while a ref is already updated by the first one.
  const running = useRef(false);

  // Reloads the product and its gallery whenever the screen is shown, so a
  // change made on the product page is reflected here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoadError(null);
      Promise.all([getProduct(Number(id)), listProductImages(Number(id))])
        .then(([loadedProduct, loadedImages]) => {
          if (cancelled) return;
          setProduct(loadedProduct);
          setImages(loadedImages);
        })
        .catch((problem: Error) => {
          if (!cancelled) setLoadError(problem.message);
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

  // Runs one add/remove action and reports it in three places the admin can see:
  // a labelled progress row, an inline banner, and (on failure) a popup offering
  // to run exactly the same thing again.
  const perform = async (
    label: string,
    title: string,
    action: () => Promise<string>,
    retry: () => void,
  ) => {
    if (running.current) return;
    running.current = true;
    setPending(label);
    setFailure(null);
    setNotice(null);
    try {
      setNotice(await action());
      await reload();
    } catch (problem) {
      setFailure({
        title,
        message:
          problem instanceof Error
            ? problem.message
            : "Something went wrong. Try again.",
        retry: { label: "Try again", run: retry },
      });
    } finally {
      running.current = false;
      setPending(null);
    }
  };

  // Adds an image by link. The typed link is left in the box on failure, so the
  // admin can correct it rather than retype it.
  const addByUrl = async (imageUrl = url) => {
    const retry = () => void addByUrl(imageUrl);
    const problem = imageUrlProblem(imageUrl);
    if (problem) {
      setNotice(null);
      setFailure({ title: "Check the image link", message: problem });
      return;
    }
    await perform(
      "Adding image…",
      "Could not add the image",
      async () => {
        await addProductImage(Number(id), imageUrl);
        setUrl("");
        return "Image added.";
      },
      retry,
    );
  };

  // Uploads one already-picked photo. Kept separate from the picker so a retry
  // re-sends the photo the admin chose instead of reopening the gallery.
  const uploadAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    const retry = () => void uploadAsset(asset);
    await perform(
      "Uploading photo…",
      "Could not upload the photo",
      async () => {
        await uploadProductImage(Number(id), {
          uri: asset.uri,
          name: asset.fileName,
          type: asset.mimeType,
          // Web fills this in; native leaves it undefined.
          file: asset.file,
        });
        return "Image uploaded.";
      },
      retry,
    );
  };

  const pickAndUpload = async () => {
    if (running.current) return;
    running.current = true;
    setFailure(null);
    setNotice(null);
    setPending("Opening your photos…");
    let asset: ImagePicker.ImagePickerAsset | null = null;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setFailure({
          title: "Photo access needed",
          message:
            "Allow photo access in your device settings, then try again to choose a picture.",
          retry: { label: "Try again", run: () => void pickAndUpload() },
        });
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        // Keeps uploads under the backend's 5 MB limit.
        quality: 0.8,
        allowsMultipleSelection: false,
        // An iPhone photo may be stored as HEIC, which the backend does not
        // accept. "Compatible" makes iOS transcode it to JPEG while picking,
        // so the file that arrives is a type the app can store. Android and
        // web ignore this option.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      // Cancelling the picker is a decision, not a failure: say nothing.
      if (picked.canceled || picked.assets.length === 0) return;
      asset = picked.assets[0];
    } catch (problem) {
      setFailure({
        title: "Could not open your photos",
        message:
          problem instanceof Error
            ? problem.message
            : "The photo picker could not be opened.",
        retry: { label: "Try again", run: () => void pickAndUpload() },
      });
      return;
    } finally {
      // Release the lock either way, so the upload below can take it and a
      // cancelled pick never leaves the screen stuck.
      running.current = false;
      setPending(null);
    }
    if (asset) await uploadAsset(asset);
  };

  // Adds the photo chosen from an Amazon listing, using the same picker as the
  // product form. It saves immediately: unlike the product form, this screen has
  // no "Save" step to defer it to.
  const addFromListing = async (imageUrl: string) => {
    await perform(
      "Adding image…",
      "Could not add the image",
      async () => {
        await addProductImage(Number(id), imageUrl);
        return "Image added.";
      },
      () => void addFromListing(imageUrl),
    );
  };

  const remove = async (image: ProductImage) => {
    const confirmed = await confirmAction(
      "Remove this image?",
      "It will no longer appear on the product page. An uploaded photo is deleted for good.",
      "Remove",
    );
    if (!confirmed) return;
    await removeImage(image);
  };

  // Separate from remove() so a retry repeats the delete without asking the
  // admin to confirm again.
  const removeImage = async (image: ProductImage) => {
    await perform(
      "Removing image…",
      "Could not remove the image",
      async () => {
        await deleteProductImage(Number(id), image.image_id);
        return "Image removed.";
      },
      () => void removeImage(image),
    );
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

        {loadError && (
          <ThemedText type="small" style={styles.loadError}>
            {loadError}
          </ThemedText>
        )}
        {!product && !loadError && <ActivityIndicator />}

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

              {images === null && !loadError && <ActivityIndicator />}
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
                      disabled={pending !== null || !canManage}
                    />
                  ))}
                </View>
              )}
            </ThemedView>

            {/* One status slot for every action: progress, or what failed, or
                what succeeded. It sits between the grid and the add controls, so
                it is in view whichever button was pressed. */}
            {pending ? (
              <ActionProgress label={pending} />
            ) : failure ? (
              <FeedbackNotice
                kind="error"
                message={failure.message}
                onDismiss={() => setFailure(null)}
              />
            ) : notice ? (
              <FeedbackNotice
                kind="success"
                message={notice}
                onDismiss={() => setNotice(null)}
              />
            ) : null}

            {canManage && (
              <ThemedView type="backgroundElement" style={styles.section}>
                <ThemedText type="smallBold">Add an image</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Photos must be PNG, JPEG, WebP, or AVIF, up to 5 MB.
                </ThemedText>

                <Pressable
                  onPress={pickAndUpload}
                  disabled={pending !== null}
                  accessibilityRole="button"
                  style={({ pressed }) => (pressed || pending !== null) && styles.pressed}
                >
                  <ThemedView type="backgroundSelected" style={styles.buttonView}>
                    <ThemedText type="smallBold">Upload from device</ThemedText>
                  </ThemedView>
                </Pressable>

                <Pressable
                  onPress={() => setPicking(true)}
                  disabled={pending !== null}
                  accessibilityRole="button"
                  style={({ pressed }) => (pressed || pending !== null) && styles.pressed}
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
                  editable={pending === null}
                  style={[
                    styles.input,
                    { color: theme.text, backgroundColor: theme.backgroundSelected },
                  ]}
                />
                <Pressable
                  onPress={() => void addByUrl()}
                  disabled={pending !== null || !url.trim()}
                  accessibilityRole="button"
                  style={({ pressed }) =>
                    (pressed || pending !== null || !url.trim()) && styles.pressed
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

      <FailureDialog failure={failure} onClose={() => setFailure(null)} />
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
  loadError: {
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
