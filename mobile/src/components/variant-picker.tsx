import { Pressable, StyleSheet, View } from 'react-native';

import { variantColors, variantSizes, type Variant } from '@/api/variants';
import { ThemedText } from '@/components/themed-text';
import { ColorSwatch } from '@/components/ui/color-swatch';
import { SectionLabel } from '@/components/ui/section-label';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  variants: Variant[];
  color: string | null;
  size: string | null;
  onColor: (color: string) => void;
  onSize: (size: string) => void;
  // Whether a store is chosen, so "sold out" means something
  hasStore: boolean;
};

// The color swatches and size chips on the product page.
//
// Colors show as round swatches with the chosen color's name above them. Sizes
// are chips; a size that's sold out at the store is crossed out but can still
// be picked (to check other stores), and a size the chosen color doesn't come
// in is hidden.
export function VariantPicker({ variants, color, size, onColor, onSize, hasStore }: Props) {
  const theme = useTheme();
  const colors = variantColors(variants);
  const sizes = variantSizes(variants);
  if (colors.length === 0 && sizes.length === 0) return null;

  // The variants of the chosen color (all of them when there are no colors)
  const ofColor = colors.length ? variants.filter((v) => v.color === color) : variants;
  const colorInStock = (name: string) => variants.some((v) => v.color === name && v.in_stock);

  return (
    <View style={styles.picker}>
      {colors.length > 0 && (
        <View style={styles.group}>
          <View style={styles.heading}>
            <SectionLabel label="Color" />
            <ThemedText type="smallBold">{color ?? 'Choose a color'}</ThemedText>
          </View>
          <View style={styles.row}>
            {colors.map((option) => {
              const chosen = option.name === color;
              const soldOut = hasStore && !colorInStock(option.name);
              return (
                <Pressable
                  key={option.name}
                  onPress={() => onColor(option.name)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  accessibilityLabel={`${option.name}${soldOut ? ', sold out' : ''}`}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.swatchRing,
                    { borderColor: chosen ? theme.link : 'transparent' },
                    pressed && styles.pressed,
                  ]}>
                  {option.hex ? (
                    <ColorSwatch
                      hex={option.hex}
                      hex2={option.hex2}
                      size={34}
                      style={soldOut && styles.soldOut}
                    />
                  ) : (
                    // No swatch color: the name's first letter instead
                    <View style={[styles.swatch, styles.letter, { borderColor: theme.border }]}>
                      <ThemedText type="smallBold">{option.name.slice(0, 1)}</ThemedText>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {sizes.length > 0 && (
        <View style={styles.group}>
          <View style={styles.heading}>
            <SectionLabel label="Size" />
            <ThemedText type="small" themeColor="textSecondary">
              {size ? `${size} selected` : 'Choose a size'}
            </ThemedText>
          </View>
          <View style={styles.row}>
            {sizes.map((option) => {
              const variant = ofColor.find((v) => v.size === option);
              if (!variant) return null;
              const chosen = option === size;
              const soldOut = hasStore && !variant.in_stock;
              return (
                <Pressable
                  key={option}
                  onPress={() => onSize(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  accessibilityLabel={`Size ${option}${soldOut ? ', sold out at this store' : ''}`}
                  style={({ pressed }) => [
                    styles.size,
                    {
                      borderColor: chosen ? theme.link : theme.border,
                      backgroundColor: chosen ? theme.backgroundSelected : 'transparent',
                    },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText
                    type={chosen ? 'smallBold' : 'small'}
                    themeColor={soldOut ? 'textSecondary' : undefined}
                    style={soldOut && styles.struck}>
                    {option}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    gap: Spacing.three,
  },
  group: {
    gap: Spacing.two,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  swatchRing: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
  },
  letter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldOut: {
    opacity: 0.35,
  },
  size: {
    minWidth: 56,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.small,
    borderWidth: 1,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  pressed: {
    opacity: 0.6,
  },
});
