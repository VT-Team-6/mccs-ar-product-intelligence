import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMyProduct, likeProduct, recordInteraction, unlikeProduct, type MyProduct } from '@/api/me';
import {
  fitLabel,
  getShopperProduct,
  listProductImages,
  productImageUrl,
  storePriceLine,
  storeStock,
  type Product,
  type ProductImage,
} from '@/api/products';
import {
  getVariants,
  hasOptions,
  variantColors,
  variantPrice,
  variantSizes,
  type Variant,
} from '@/api/variants';
import { useAuth } from '@/auth/AuthContext';
import { useSignInPrompt } from '@/auth/use-sign-in-prompt';
import { ProductImageGallery } from '@/components/product-image-gallery';
import { RecommendationPanel } from '@/components/recommendation-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SectionLabel } from '@/components/ui/section-label';
import { Brand, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AIAnalysisPanel} from '@/components/ai-analysis-panel';
import { NearbyStores } from '@/components/nearby-stores';
import { useStore } from '@/store/StoreContext';
import { AddToShoppingList } from '@/components/add-to-shopping-list';
import { ShoppingListStatus } from '@/components/shopping-list-status';
import { VariantPicker } from '@/components/variant-picker';
import { PHOTO_OPTION } from '@/constants/variants';

export default function ShopperProductScreen() {
  // The [id] in this file's name: /product/2 gives id = "2".
  // "from" is the page to return to, such as /search?q=nike (optional).
  // "via" is "recommendation" when opened from a recommendation card.
  // color/size: open on that option (from Likes or the shopping list)
  const { id, from, via, color: openColor, size: openSize } = useLocalSearchParams<{
    id: string;
    from?: string;
    via?: string;
    color?: string;
    size?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { store, openStoreSelector } = useStore();
  const { user } = useAuth();
  const promptSignIn = useSignInPrompt();

  const [product, setProduct] = useState<MyProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  // The product's extra photos, featured image not included. A failure here is not
  // an error for the page: the featured image alone still works.
  const [extraImages, setExtraImages] = useState<ProductImage[]>([]);
  // The colors/sizes it comes in, with stock at the store, and the shopper's pick
  const [variants, setVariants] = useState<Variant[]>([]);
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  // True while a like request is running, so the heart cannot be double-tapped
  const [savingLike, setSavingLike] = useState(false);
  // Stops one visit from being recorded more than once
  const recorded = useRef(false);
  // True once "Continue to analysis, recommendations & reviews" is pressed
  const [showMore, setShowMore] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Where the questions/results start on the page, so we can scroll them to the top
  const panelY = useRef(0);
  // Goes up by one when the product is added to a list, so the list line reloads
  const [listVersion, setListVersion] = useState(0);

  // Loads this product and the caller's like state when the page opens.
  // A product from a different page is ignored while the new one loads.
  // The store is a dependency: switching it refetches so the price follows.
  useEffect(() => {
    let cancelled = false;
    const productId = Number(id);
    const request = user
      ? getMyProduct(productId, store?.store_id)
      : getShopperProduct(productId, store?.store_id).then((loaded) => ({ ...loaded, is_liked: false }));
    request.then((loaded) => {
        if (cancelled) return;
        setProduct(loaded);
        setLoadedId(loaded.product_id);
      })
      .catch((problem: Error) => {
        if (!cancelled) setError(problem.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, store?.store_id, user]);

  // The extra photos are a separate request so the product payload stays the
  // same shape everywhere else in the app. They are loaded alongside the
  // product and a failure is ignored: the featured image alone is still usable.
  useEffect(() => {
    let cancelled = false;
    const productId = Number(id);
    if (!Number.isInteger(productId)) return;
    listProductImages(productId)
      .then((images) => {
        if (cancelled) return;
        setExtraImages(images);
      })
      .catch(() => {
        if (!cancelled) setExtraImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The colors and sizes, priced at the store. A failure leaves the page as it
  // was before colors and sizes existed: one product, one price.
  useEffect(() => {
    let cancelled = false;
    const productId = Number(id);
    if (!Number.isInteger(productId)) return;
    getVariants(productId, store?.store_id)
      .then((loaded) => {
        if (cancelled) return;
        setVariants(loaded);
        const colors = variantColors(loaded);
        const sizes = variantSizes(loaded);
        // Keep the shopper's pick across a store change; otherwise start on the
        // first color in stock. A size is preselected only when it's the only
        // option (coffee, shampoo), so shoe shoppers always pick their own.
        setColor((current) =>
          current && colors.some((c) => c.name === current)
            ? current
            : openColor && colors.some((c) => c.name === openColor)
              ? openColor
              : (loaded.find((v) => v.color && v.in_stock)?.color ?? colors[0]?.name ?? null),
        );
        setSize((current) =>
          current && sizes.includes(current)
            ? current
            : openSize && sizes.includes(openSize)
              ? openSize
              : colors.length === 0
              ? (loaded.find((v) => v.size && v.in_stock)?.size ?? sizes[0] ?? null)
              : null,
        );
      })
      .catch(() => {
        if (!cancelled) setVariants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id, store?.store_id]);

  // Records that this product was opened in user history.
  useEffect(() => {
    const productId = Number(id);
    if (!user || recorded.current || !Number.isInteger(productId)) return;
    recorded.current = true;
    const fromSearch = (from ?? '').startsWith('/search') || (from ?? '').startsWith('/find');
    // Opens from recommendation cards teach "Recommended for You" what people pick
    const interaction =
      via === 'recommendation'
        ? 'viewed-from-recommendation'
        : fromSearch
          ? 'viewed-from-search'
          : 'viewed';
    // Fire and forget: history must never block showing the product
    recordInteraction(productId, interaction, store?.store_id).catch(() => undefined);
  }, [id, from, via, store?.store_id, user]);

  // Back goes to the previous page, else the "from" page, else Home (BackButton)

  // Toggles the state of the heart icon and sends to backend.
  // If the backend fails, the heart is restored to its previous state.
  const toggleLike = async () => {
    if (!product || savingLike) return;
    if (!user) {
      await promptSignIn('Sign in to save products to your likes.');
      return;
    }
    const liked = !product.is_liked;
    setProduct({ ...product, is_liked: liked });
    setSavingLike(true);
    setError(null);
    try {
      if (liked) {
        await likeProduct(product.product_id, store?.store_id, color);
      } else {
        await unlikeProduct(product.product_id, store?.store_id);
      }
    } catch (problem) {
      setProduct((current) => (current ? { ...current, is_liked: !liked } : current));
      setError(likeErrorMessage(problem));
    } finally {
      setSavingLike(false);
    }
  };

  const imageUrl = product ? productImageUrl(product) : null;
  const options = hasOptions(variants);
  const usesColor = variantColors(variants).length > 0;
  const usesSize = variantSizes(variants).length > 0;
  // The variant the shopper picked, once every option it has is chosen
  const chosen = options
    ? (variants.find(
        (v) => (!usesColor || v.color === color) && (!usesSize || v.size === size),
      ) ?? null)
    : (variants[0] ?? null);

  // Photos follow the option that changes how it looks (color for shoes, size
  // for coffee). The picked option's own photos come first and replace the
  // featured image; without its own photos the featured image shows. Photos of
  // other options are left out, so a 24 oz bag never shows the 12 oz package.
  const galleryImages = useMemo(() => {
    if (!product) return [];
    const option = product.category ? PHOTO_OPTION[product.category] : null;
    const picked = option === 'color' ? color : option === 'size' ? size : null;
    const own = extraImages.filter(
      (image) => option && picked && (image[option] ?? '').toLowerCase() === picked.toLowerCase(),
    );
    const shared = extraImages.filter((image) => !image.color && !image.size);
    const lead = own.length > 0 ? own : imageUrl ? [{ image_url: imageUrl } as ProductImage] : [];
    return [...lead, ...shared]
      .map((image) => productImageUrl(image))
      .filter((url): url is string => !!url);
  }, [product, extraImages, imageUrl, color, size]);

  // The store has this product on record but no longer sells it. Shown as its
  // own state so a scan never implies a price or availability that isn't there.
  const discontinued = product?.store_inventory?.status === 'discontinued';
  // Never prints a price without a matching store behind it.
  const price = product
    ? storePriceLine(product, store?.store_id ?? null, store?.name ?? null)
    : null;
  // With a size/color picked, its own price; otherwise "From $X" when sizes cost different amounts
  // With only a color picked, the prices of that color's sizes
  const pool = options && color && !chosen ? variants.filter((v) => v.color === color) : variants;
  const poolPrices = [...new Set(pool.map((v) => variantPrice(v)).filter((p): p is number => p !== null))];
  const chosenPrice = options && chosen && product?.store_inventory ? variantPrice(chosen) : null;
  const priceText =
    chosenPrice !== null
      ? `$${chosenPrice.toFixed(2)}`
      : !price?.price
        ? (price?.price ?? '—')
        : poolPrices.length === 1
          ? `$${poolPrices[0].toFixed(2)}`
          : poolPrices.length > 1
            ? `From $${Math.min(...poolPrices).toFixed(2)}`
            : price.price;
  const availability =
    options && chosen && product?.store_inventory
      ? chosen.in_stock
        ? `In stock (${chosen.quantity})`
        : 'Sold out here'
      : product
        ? storeStock(product)
        : '';

   // New questions or results appear below the product, so scroll them to the top of the screen
  const scrollToPanel = () => {
    setTimeout(() => scrollRef.current?.scrollTo({ y: panelY.current, animated: true }), 150);
  };

  // Opens a recommended product on its own details page. Back returns here, results intact.
  // "from" keeps Back working after a web refresh too (see UI_STANDARDS.md).
  const openProduct = (picked: Product) => {
    const here = `/product/${id}`;
    router.push(
      `/product/${picked.product_id}?from=${encodeURIComponent(here)}&via=recommendation` as Href,
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title="Product details" eyebrow={store?.name ?? 'MCCS'} from={from} />

      <View style={styles.page}>
        {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
        {(!product || loadedId !== Number(id)) && !error && <ActivityIndicator />}

        {product && loadedId === Number(id) && (
          <ScrollView
            ref={scrollRef}
            // Reaches the screen's edges so the scroll bar sits at the far right;
            // the content keeps the page's side padding
            style={styles.edgeToEdge}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.two }]}>
            <ProductImageGallery imageUrls={galleryImages} productName={product.name} />

            <ThemedView style={styles.section}>
              <ThemedText type="subtitle" style={styles.name}>
                {product.name}
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                {[product.brand, fitLabel(product.fit), product.product_type].filter(Boolean).join(' · ')}
              </ThemedText>
            </ThemedView>

            <Pressable
              onPress={toggleLike}
              disabled={savingLike}
              accessibilityRole="button"
              accessibilityLabel={
                product.is_liked
                  ? `Remove ${product.name} from Likes`
                  : `Save ${product.name} to Likes`
              }
              accessibilityState={{ selected: product.is_liked, busy: savingLike }}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type="card"
                style={[
                  styles.likeButton,
                  { borderColor: product.is_liked ? Brand.red : theme.border },
                ]}>
                <ThemedText type="subtitle" themeColor={product.is_liked ? "danger" : undefined} style={styles.heart}>
                  {product.is_liked ? '♥' : '♡'}
                </ThemedText>
                <ThemedText type="smallBold">
                  {product.is_liked ? 'Saved to Likes' : 'Save to Likes'}
                </ThemedText>
              </ThemedView>
            </Pressable>

            {/* Where this product stands on the active list, then a way to add it
                to any list. */}
            {user ? (
              <ShoppingListStatus productId={product.product_id} refreshKey={listVersion} />
            ) : null}
            {options && (
              <VariantPicker
                variants={variants}
                color={color}
                size={size}
                onColor={(picked) => {
                  setColor(picked);
                  // Keep the size if the new color comes in it
                  if (size && !variants.some((v) => v.color === picked && v.size === size)) setSize(null);
                }}
                onSize={setSize}
                hasStore={!!product.store_inventory}
              />
            )}

            <AddToShoppingList
              productId={product.product_id}
              variantId={options ? (chosen?.variant_id ?? null) : null}
              // A color picked without a size is saved as that color, any size
              color={options && !chosen && usesColor ? color : null}
              variantLabel={
                options && chosen
                  ? [chosen.color, chosen.size].filter(Boolean).join(' / ')
                  : options && usesColor && color
                    ? `${color}${usesSize ? ', any size' : ''}`
                    : null
              }
              onAdded={() => setListVersion((version) => version + 1)}
            />

            <ThemedView type="card" style={[styles.facts, { borderColor: theme.border }]}>
              {discontinued ? (
                <Fact label="Availability" value="Discontinued at this store" />
              ) : (
                <>
                  <Fact label="Price" value={priceText} />
                  {product.store_inventory && (
                    <Fact label="Availability" value={availability} wide />
                  )}
                </>
              )}
              <Fact
                label="Rating"
                value={product.rating === null ? 'No rating' : `${product.rating.toFixed(1)} / 5`}
              />
            </ThemedView>

            {/* The store behind the price, or a prompt to pick one. Tap targets
                the same shared sheet as every other surface. */}
            {!discontinued && !price?.price && (
              <Pressable
                onPress={() => openStoreSelector()}
                accessibilityRole="button"
                hitSlop={8}>
                <ThemedText type={price?.needsStore ? 'linkPrimary' : 'small'} themeColor="textSecondary">
                  {price?.needsStore
                    ? 'Select a store to view price and availability.'
                    : price?.label}
                </ThemedText>
              </Pressable>
            )}

            {/* The cross-sell: reuses the active-store selector, so picking a
                location reprices the whole catalog and this page refetches. */}
            {store !== null && (
              <Pressable
                onPress={() => openStoreSelector()}
                accessibilityRole="button"
                hitSlop={8}>
                <ThemedText type="linkPrimary">Check another store</ThemedText>
              </Pressable>
            )}

            {discontinued && (
              <ThemedView type="backgroundSelected" style={styles.discontinuedNotice}>
                <ThemedText type="smallBold">No longer available at this store</ThemedText>
                <ThemedText themeColor="textSecondary">
                  This product has been discontinued here. Try another store to see if it is
                  still available.
                </ThemedText>
              </ThemedView>
            )}

            <NearbyStores productId={product.product_id} />

            {product.description && <ThemedText>{product.description}</ThemedText>}

              {showMore ? (
                <>
                  {/* AI analysis */}
                  <View onLayout={(event) => (panelY.current = event.nativeEvent.layout.y)}>
                    <AIAnalysisPanel productId={product.product_id} />
                    
                    <RecommendationPanel
                      productId={product.product_id}
                      category={product.category}
                      onOpenProduct={openProduct}
                      onStepChange={scrollToPanel}
                    />
                  </View>
                </>
            ) : (
              <Pressable
                onPress={() => {
                  setShowMore(true);
                  scrollToPanel();
                }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
                <ThemedText type="smallBold" style={styles.moreText}>
                  Continue to analysis, recommendations & reviews
                </ThemedText>
              </Pressable>
            )}
          </ScrollView>
        )}
      </View>
    </ThemedView>
  );
}

function likeErrorMessage(problem: unknown): string {
  if (problem instanceof TypeError) {
    return 'Could not reach the backend. Is it running?';
  }
  if (problem instanceof Error) {
    return problem.message;
  }
  return 'Could not save your like.';
}

// One of the three facts side by side. Availability is the longest word, so it
// gets a wider share of the row ("wide") to keep every label on one line.
function Fact({
  label,
  value,
  strong = false,
  wide = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  wide?: boolean;
}) {
  return (
    <ThemedView type="card" style={[styles.fact, wide && styles.factWide]}>
      <SectionLabel label={label} style={styles.factLabel} />
      <ThemedText
        type="smallBold"
        themeColor={strong ? 'link' : undefined}
        // A long price shrinks a little instead of breaking onto two lines
        numberOfLines={strong ? 1 : undefined}
        adjustsFontSizeToFit={strong}
        style={strong && styles.strong}>
        {value}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.4,
  },
  edgeToEdge: {
    marginHorizontal: -Spacing.four,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  section: {
    gap: Spacing.one,
  },
  name: {
    fontSize: 26,
    lineHeight: 32,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  heart: {
    fontSize: 26,
    lineHeight: 30,
  },
  facts: {
    flexDirection: 'row',
    borderRadius: Radius.medium,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  strong: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  discontinuedNotice: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  fact: {
    flex: 1,
    gap: Spacing.half,
  },
  factWide: {
    flex: 1.4,
  },
  // Slightly tighter spacing than other labels so AVAILABILITY fits one line
  factLabel: {
    letterSpacing: 1,
  },
  moreButton: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
    backgroundColor: Brand.navy,
  },
  moreText: {
    color: '#ffffff',
    textAlign: 'center',
  },
});