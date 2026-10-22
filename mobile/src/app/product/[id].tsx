import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getMyProduct, likeProduct, recordInteraction, unlikeProduct, type MyProduct } from '@/api/me';
import { productImageUrl, type Product } from '@/api/products';
import { RecommendationPanel } from '@/components/recommendation-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

export default function ShopperProductScreen() {
  // The [id] in this file's name: /product/2 gives id = "2".
  // "from" is the page to return to, such as /search?q=nike (optional).
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();

  const [product, setProduct] = useState<MyProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  // True once "Continue to analysis, recommendations & reviews" is pressed
  const [savingLike, setSavingLike] = useState(false);
  // Stops one visit from being recorded more than once
  const recorded = useRef(false);
  // The bottom bar: "ask" shows it, "open" shows the recommendation questions/results, "dismissed" hides it
  const [showMore, setShowMore] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Loads this product and the caller's like state when the page opens.
  // A product from a different page is ignored while the new one loads.
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
  }, [id]);

  // Records that this product was opened in user history.
  useEffect(() => {
    const productId = Number(id);
    if (recorded.current || !Number.isInteger(productId)) return;
    recorded.current = true;
    const fromSearch = (from ?? '').startsWith('/search');
    // Fire and forget: history must never block showing the product
    recordInteraction(productId, fromSearch ? 'viewed-from-search' : 'viewed').catch(
      () => undefined,
    );
  }, [id, from]);

  // Go to the previous page, else the "from" page, else the home page. 
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (from && from.startsWith('/')) {
      router.replace(from as Href);
    } else {
      router.replace('/');
    }
  };

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

  // New questions or results appear below the product, so scroll down to show them
  const scrollToBottom = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
  };

  // Opens a recommended product on its own details page. Back returns here, results intact.
  const openProduct = (picked: Product) => {
    router.push(`/product/${picked.product_id}` as Href);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={goBack} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="linkPrimary">‹ Back</ThemedText>
        </Pressable>

        {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
        {(!product || loadedId !== Number(id)) && !error && <ActivityIndicator />}

        {product && loadedId === Number(id) && (
          <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
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
                type={product.is_liked ? 'backgroundSelected' : 'backgroundElement'}
                style={styles.likeButton}>
                <ThemedText type="subtitle" style={styles.heart}>
                  {product.is_liked ? '♥' : '♡'}
                </ThemedText>
                <ThemedText type="smallBold">
                  {product.is_liked ? 'Saved to Likes' : 'Save to Likes'}
                </ThemedText>
              </ThemedView>
            </Pressable>

            <ThemedView type="backgroundElement" style={styles.facts}>
              <Fact
                label="Price"
                value={product.price === null ? 'No price' : `$${product.price.toFixed(2)}`}
              />
              <Fact
                label="Rating"
                value={product.rating === null ? 'No rating' : `${product.rating.toFixed(1)} / 5`}
              />
            </ThemedView>

            {product.description && <ThemedText>{product.description}</ThemedText>}

                        {showMore ? (
              <>
                {/* AI analysis (task 6.15) goes here */}
                <RecommendationPanel
                  productId={product.product_id}
                  onOpenProduct={openProduct}
                  onStepChange={scrollToBottom}
                />
              </>
            ) : (
              <Pressable
                onPress={() => {
                  setShowMore(true);
                  scrollToBottom();
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
      </SafeAreaView>
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
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    // On web the tab bar sits at the top, so leave room for it
    paddingTop: Platform.OS === 'web' ? Spacing.six + Spacing.four : Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  pressed: {
    opacity: 0.4,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  image: {
    width: '100%',
    aspectRatio: 1.4,
    borderRadius: Spacing.three,
  },
  // Product photos have see-through backgrounds, so they sit on white in both light and dark mode
  whiteBackground: {
    backgroundColor: '#ffffff',
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
    borderRadius: Spacing.three,
  },
  heart: {
    fontSize: 26,
    lineHeight: 30,
  },
  facts: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  fact: {
    flex: 1,
    gap: Spacing.half,
  },
  moreButton: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: '#3c87f7',
  },
  moreText: {
    color: '#ffffff',
    textAlign: 'center',
  },
});