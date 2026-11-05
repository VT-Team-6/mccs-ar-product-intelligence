import { API_URL } from "./config";
import { getShopperProduct, type Product } from "./products";

// One product in a comparison, with the extra details the screen shows
export type CompareItem = {
  product: Product;
  // How many reviews we have for it, or null if that couldn't be loaded
  review_count: number | null;
};

export type ComparisonData = {
  items: CompareItem[];
  // Products that no longer exist (deleted, or a bad link)
  missing: number[];
};

// Gathers each product's details for the comparison screen.
// For now this calls the existing product and review endpoints once per product.
// When the comparison endpoint (task 16) is ready, only this function needs to change.
export async function getComparison(ids: number[]): Promise<ComparisonData> {
  const results = await Promise.allSettled(ids.map(loadItem));

  const items: CompareItem[] = [];
  const missing: number[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(result.value);
    } else if (result.reason instanceof Error && result.reason.message === "Product not found") {
      missing.push(ids[index]);
    } else {
      // Anything else (backend down, server error) fails the whole comparison
      throw result.reason;
    }
  });
  return { items, missing };
}

async function loadItem(productId: number): Promise<CompareItem> {
  const product = await getShopperProduct(productId);
  return { product, review_count: await reviewCount(productId) };
}

// The review count is nice to have, so a problem here never blocks the comparison
async function reviewCount(productId: number): Promise<number | null> {
  try {
    const response = await fetch(`${API_URL}/api/products/${productId}/reviews/aggregate`);
    if (!response.ok) return null;
    const data: { review_count?: unknown } = await response.json();
    return typeof data.review_count === "number" ? data.review_count : null;
  } catch {
    return null;
  }
}