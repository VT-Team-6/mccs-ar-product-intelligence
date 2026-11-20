import { authenticatedFetch, withStore } from "./client";
import type { Product } from "./products";

export type CompareItem = {
  product: Product;
  review_count: number | null;
  pros: string[];
  cons: string[];
  notes: string[];
};

export type ComparisonData = {
  items: CompareItem[];
  missing: number[];
  best_for_you: number | null;
};

export async function getComparison(
  ids: number[],
  storeId?: number,
): Promise<ComparisonData> {
  const response = await authenticatedFetch(withStore("/api/compare", storeId), {
    method: "POST",
    body: JSON.stringify({
      product_ids: ids,
    }),
  });

  if (!response.ok) {
    // The backend explains refusals, e.g. products from different categories
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string" ? body.detail : `Could not load comparison (${response.status}).`
    );
  }

  return response.json();
}