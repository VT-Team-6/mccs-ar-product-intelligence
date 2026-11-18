import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMyProduct, likeProduct, recordInteraction, unlikeProduct, type MyProduct } from '@/api/me';
import {
  listProductImages,
  productImageUrl,
  storePriceLine,
  storeStock,
  type Product,
} from '@/api/products';
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

export default function ShopperProductScreen() {
  // The [id] in this file's name: /product/2 gives id = "2".
  // "from" is the page to return to, such as /search?q=nike (optional).
  // "via" is "recommendation" when opened from a recommendation card.
  const { id, from, via } = useLocalSearchParams<{ id: string; from?: string; via?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { store, openStoreSelector } = useStore();

  const [product, setProduct] = useState<MyProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  // The product's extra photos, featured image not included. A failure here is not
  // an error for the page: the featured image alone still works.
  const [extraImages, setExtraImages] = useState<string[]>([]);
  // True while a like request is running, so the heart cannot be double-tapped
  const [savingLike, setSavingLike] = useState(false);
  // Stops one visit from being recorded more than once
  const recorded = useRef(false);
  // True once "Continue to analysis, recommendations & reviews" is pressed
  const [showMore, setShowMore] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Where the questions/results start on the page, so we can scroll them to the top
  const panelY = useRef(0);

  // Loads this product and the caller's like state when the page opens.
  // A product from a different page is ignored while the new one loads.
  // The store is a dependency: switching it refetches so the price follows.
  useEffect(() => {
    let cancelled = false;
    getMyProduct(Number(id))
      .then((loaded) => {
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
  }, [id, store?.store_id]);

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
        setExtraImages(
          images.map((image) => productImageUrl(image)).filter((url): url is string => !!url),
        );
      })
      .catch(() => {
        if (!cancelled) setExtraImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Records that this product was opened in user history.
  useEffect(() => {
    const productId = Number(id);
    if (recorded.current || !Number.isInteger(productId)) return;
    recorded.current = true;
    const fromSearch = (from ?? '').startsWith('/search');
    // Opens from recommendation cards teach "Recommended for You" what people pick
    const interaction =
      via === 'recommendation'
        ? 'viewed-from-recommendation'
        : fromSearch
          ? 'viewed-from-search'
          : 'viewed';
    // Fire and forget: history must never block showing the product
    recordInteraction(productId, interaction).catch(() => undefined);
  }, [id, from, via]);

  // Back goes to the previous page, else the "from" page, else Home (BackButton)

  // Toggles the state of the heart icon and sends to backend.
  // If the backend fails, the heart is restored to its previous state.
  const toggleLike = async () => {
    if (!product || savingLike) return;
    const liked = !product.is_liked;
    setProduct({ ...product, is_liked: liked });
    setSavingLike(true);
    setError(null);
    try {
      if (liked) {
        await likeProduct(product.product_id);
      } else {
        await unlikeProduct(product.product_id);
      }
    } catch (problem) {
      setProduct((current) => (current ? { ...current, is_liked: !liked } : current));
      setError(likeErrorMessage(problem));
    } finally {
      setSavingLike(false);
    }
  };

  const imageUrl = product ? productImageUrl(product) : null;
  // Featured photo first, then the extra ones, so the gallery's first slide is
  // exactly what every card and listing shows.
  const galleryImages = product
    ? [...(imageUrl ? [imageUrl] : []), ...extraImages]
    : [];

  // The store has this product on record but no longer sells it. Shown as its
  // own state so a scan never implies a price or availability that isn't there.
  const discontinued = product?.store_inventory?.status === 'discontinued';
  // Never prints a price without a matching store behind it.
  const price = product
    ? storePriceLine(product, store?.store_id ?? null, store?.name ?? null)
    : null;

   // New questions or results appear below the product, so scroll them to the top of the screen
  const scrollToPanel = () => {
    setTimeout(() => scrollRef.current?.scrollTo({ y: panelY.current, animated: true }), 150);
  };

  // Opens a recommended product on its own details page. Back returns here, results intact.
  const openProduct = (picked: Product) => {
    router.push(`/product/${picked.product_id}?via=recommendation` as Href);
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
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.two }]}>
            <ProductImageGallery imageUrls={galleryImages} productName={product.name} />

            <ThemedView style={styles.section}>
              <ThemedText type="subtitle" style={styles.name}>
                {product.name}
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                {[product.brand, product.product_type].filter(Boolean).join(' · ')}
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
                <ThemedText type="subtitle" style={[styles.heart, product.is_liked && styles.liked]}>
                  {product.is_liked ? '♥' : '♡'}
                </ThemedText>
                <ThemedText type="smallBold">
                  {product.is_liked ? 'Saved to Likes' : 'Save to Likes'}
                </ThemedText>
              </ThemedView>
            </Pressable>

            {/* Allow customers to add this product to any shopping list. */}
            <AddToShoppingList productId={product.product_id} />

            <ThemedView type="card" style={[styles.facts, { borderColor: theme.border }]}>
              {discontinued ? (
                <Fact label="Availability" value="Discontinued at this store" />
              ) : (
                <>
                  <Fact label="Price" value={price?.price ?? '—'} strong />
                  {product.store_inventory && (
                    <Fact label="Availability" value={storeStock(product)} />
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

function Fact({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <ThemedView type="card" style={styles.fact}>
      <SectionLabel label={label} />
      <ThemedText
        type="smallBold"
        themeColor={strong ? 'link' : undefined}
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
  content: {
    gap: Spacing.three,
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
  liked: {
    color: Brand.red,
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