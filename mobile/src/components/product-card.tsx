import { Image } from 'expo-image';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { productImageUrl, type Product } from '@/api/products';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export type ProductCardProps = {
  product: Product;
  onPress?: () => void;
  // Secondary line under the product details, such as "Liked Oct 18".
  meta?: string | null;
  // Label above the details, used by History to say how the user got here.
  event?: string | null;
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
  isLiked,
  onToggleLike,
  style,
}: ProductCardProps) {
  const details = [product.brand, product.product_type].filter(Boolean).join(' · ');
  const price = product.price === null ? 'No price' : `$${product.price.toFixed(2)}`;
  const imageUrl = productImageUrl(product);

  return (
    // Card format sourced from search page.
    <ThemedView type="backgroundElement" style={[styles.row, style]}>
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

        <ThemedView type="backgroundElement" style={styles.rowText}>
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
        </ThemedView>

        <ThemedText type="smallBold">{price}</ThemedText>
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
            style={styles.heart}
            themeColor={isLiked ? 'text' : 'textSecondary'}>
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
    borderRadius: Spacing.three,
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
  heart: {
    fontSize: 26,
    lineHeight: 30,
  },
});
