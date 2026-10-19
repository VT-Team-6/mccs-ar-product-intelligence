import { authenticatedFetch } from "./client";
import type { Product } from "./products";

// A product plus whether the signed-in user currently likes it.
export type MyProduct = Product & {
  is_liked: boolean;
};

// A product in the Likes tab, with when it was liked.
export type LikedProduct = Product & {
  liked_at: string;
};

// One interaction event. The same product can appear more than once.
export type HistoryItem = {
  history_id: number;
  interaction: string;
  occurred_at: string;
  product: MyProduct;
};

// Cursor-paged lists: pass next_cursor back to fetch the following page.
export type LikedProductPage = {
  items: LikedProduct[];
  next_cursor: string | null;
};

export type HistoryPage = {
  items: HistoryItem[];
  next_cursor: string | null;
};

// Interactions the client may report. Likes are recorded by the server when
// the like state actually changes, so they are not accepted here.
export type ClientInteraction = "scanned" | "viewed" | "viewed-from-search";

export type LikedSort = "recent" | "name" | "rating" | "price";

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${fallback} (error ${response.status})`);
  }
  return response.json();
}

// Build a query string from the given parameters, omitting any that are null, undefined, or empty.
function queryString(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// The product detail page: product fields plus the caller's like state
export async function getMyProduct(productId: number): Promise<MyProduct> {
  const response = await authenticatedFetch(`/api/me/products/${productId}`);
  if (response.status === 404) {
    throw new Error("Product not found");
  }
  return readJson(response, "Could not load the product");
}

// The Likes tab. Search only narrows the user's own likes.
export async function listLikedProducts(options: {
  query?: string;
  sort?: LikedSort;
  limit?: number;
  cursor?: string | null;
} = {}): Promise<LikedProductPage> {
  const response = await authenticatedFetch(
    `/api/me/liked-products${queryString({
      q: options.query,
      sort: options.sort,
      limit: options.limit,
      cursor: options.cursor,
    })}`,
  );
  return readJson(response, "Could not load your likes");
}

// The History tab. Search only narrows the user's own events.
export async function listProductHistory(options: {
  query?: string;
  limit?: number;
  cursor?: string | null;
} = {}): Promise<HistoryPage> {
  const response = await authenticatedFetch(
    `/api/me/product-history${queryString({
      q: options.query,
      limit: options.limit,
      cursor: options.cursor,
    })}`,
  );
  return readJson(response, "Could not load your history");
}

// Both calls are idempotent, so repeating one is harmless.
export async function likeProduct(productId: number): Promise<MyProduct> {
  const response = await authenticatedFetch(`/api/me/liked-products/${productId}`, {
    method: "PUT",
  });
  return readJson(response, "Could not like the product");
}

export async function unlikeProduct(productId: number): Promise<MyProduct> {
  const response = await authenticatedFetch(`/api/me/liked-products/${productId}`, {
    method: "DELETE",
  });
  return readJson(response, "Could not remove the like");
}

// Records that the user scanned or opened a product, for the History tab.
export async function recordInteraction(
  productId: number,
  interaction: ClientInteraction,
): Promise<void> {
  const response = await authenticatedFetch("/api/me/product-interactions", {
    method: "POST",
    body: JSON.stringify({ product_id: productId, interaction }),
  });
  if (!response.ok) {
    throw new Error(`Could not record the interaction (error ${response.status})`);
  }
}
