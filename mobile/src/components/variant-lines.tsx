import { ThemedText } from '@/components/themed-text';

type Props = {
  color?: string | null;
  size?: string | null;
};

// "Color: Black" and "Size: 10", each on its own line under an item's name,
// so a size is never mistaken for a quantity. Nothing for products without options.
export function VariantLines({ color, size }: Props) {
  return (
    <>
      {!!color && (
        <ThemedText type="small" themeColor="textSecondary">{`Color: ${color}`}</ThemedText>
      )}
      {!!size && (
        <ThemedText type="small" themeColor="textSecondary">{`Size: ${size}`}</ThemedText>
      )}
    </>
  );
}
