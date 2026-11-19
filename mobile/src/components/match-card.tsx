import type { Product } from '@/api/products';
import type { Recommendation } from '@/api/recommendations';
import { ProductCard } from '@/components/product-card';
import { Brand } from '@/constants/theme';

// A red left edge on the For You pick. A plain object rather than a StyleSheet
// style, because on web the card's own border color would otherwise win over it.
const FOR_YOU_EDGE = { borderLeftWidth: 5, borderLeftColor: Brand.red };

// An advanced search result: a product card with its rank and the reasons it
// was picked. Used by Ask Chesty and the Best matches page.
export function MatchCard({
  item,
  rank,
  onOpen,
  highlight = false,
}: {
  item: Recommendation;
  // Shown as a red "#1" tag
  rank?: number;
  onOpen: (product: Product) => void;
  highlight?: boolean;
}) {
  return (
    <ProductCard
      product={item.product}
      onPress={() => onOpen(item.product)}
      badge={rank !== undefined ? `#${rank}` : null}
      meta={item.reasons.length > 0 ? item.reasons.join(' · ') : null}
      style={highlight ? FOR_YOU_EDGE : undefined}
    />
  );
}
