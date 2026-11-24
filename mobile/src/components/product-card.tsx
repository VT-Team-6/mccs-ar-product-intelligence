import { Image } from 'expo-image';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { fitLabel, productImageUrl, storePriceLine, type Product } from '@/api/products';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/store/StoreContext';

export type ProductCardProps = {
  product: Product;
  onPress?: () => void;
  // Secondary line under the product details, such as "Liked Oct 18".
  meta?: string | null;
  // Label above the details, used by History to say how the user got here.
  event?: string | null;
  // Small red tag above the name, such as the "#1" rank on search results
  badge?: string | null;
  // The current like state, when the caller has one. Omit to hide the heart.
  isLiked?: boolean;
  onToggleLike?: () => void;
  style?: StyleProp<ViewStyle>;
};

// The catalog row shared by search, Likes, and History. Only the metadata line
// and the like button differ between screens, so those stay optional.
export function ProductCard({
  product,
  onPress,
  meta,
  event,
  badge,
  isLiked,
  onToggleLike,
  style,
}: ProductCardProps) {
  const details = [product.brand, fitLabel(product.fit), product.product_type].filter(Boolean).join(' · ');
  const { store, openStoreSelector } = useStore();
  // One shared sheet, reached from the prompt rather than a modal per card.
  const price = storePriceLine(product, store?.store_id ?? null, store?.name ?? null);
  const imageUrl = productImageUrl(product);
  const theme = useTheme();

  return (
    // Card format sourced from search page.
    <ThemedView type="card" style={[styles.row, { borderColor: theme.border }, style]}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        style={({ pressed }) => [
          styles.tapArea,
          pressed && onPress ? styles.pressed : null,
        ]}>
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
          {badge && (
            <ThemedText style={styles.badge}>{badge}</ThemedText>
          )}
          {event && (
            <ThemedText type="small" themeColor="textSecondary">
              {event}
            </ThemedText>
          )}
          <ThemedText type="smallBold">{product.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {details}
          </ThemedText>
          {product.rating !== null && (
            <ThemedText type="small" themeColor="textSecondary">
              {`${product.rating.toFixed(1)} rating`}
            </ThemedText>
          )}
          {meta && (
            <ThemedText type="small" themeColor="textSecondary">
              {meta}
            </ThemedText>
          )}

          {/* The price never appears without a store behind it. Without one the
              label is a button opening the same sheet as every other surface. */}
          {price.needsStore ? (
            <Pressable
              onPress={() => openStoreSelector()}
              accessibilityRole="button"
              accessibilityLabel="Select a store to view price and availability"
              hitSlop={8}>
              <ThemedText type="small" themeColor="textSecondary">
                {price.label}
              </ThemedText>
            </Pressable>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {price.label}
            </ThemedText>
          )}
        </ThemedView>

        {price.price && (
          <ThemedText themeColor="link" style={styles.price}>
            {price.price}
          </ThemedText>
        )}
      </Pressable>

      {onToggleLike && (
        <Pressable
          onPress={onToggleLike}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={
            isLiked
              ? `Remove ${product.name} from Likes`
              : `Save ${product.name} to Likes`
          }
          accessibilityState={{ selected: isLiked }}
          style={({ pressed }) => [styles.heartButton, pressed && styles.pressed]}>
          <ThemedText
            type="subtitle"
            themeColor={isLiked ? "danger" : "textSecondary"}
            style={styles.heart}>
            {isLiked ? '♥' : '♡'}
          </ThemedText>
        </Pressable>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  // The product details are the big tap target; the heart sits beside it
  tapArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
  },
  // Product photos have see-through backgrounds, so they sit on white in both light and dark mode
  whiteBackground: {
    backgroundColor: '#ffffff',
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  heartButton: {
    alignItems: 'center',
    justifyContent: 'center',
    // Keeps the heart a comfortable tap target on a phone
    minWidth: 44,
    minHeight: 44,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: Brand.red,
    color: '#ffffff',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  price: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  heart: {
    fontSize: 26,
    lineHeight: 30,
  },
});