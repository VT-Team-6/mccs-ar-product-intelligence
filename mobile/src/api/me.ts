import { authenticatedFetch, withStore } from "./client";
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
// The store fields are flat and describe the event, not the product: they can
// differ from the shopper's current store and the product's current price.
export type HistoryItem = {
  history_id: number;
  interaction: string;
  occurred_at: string;
  store_id: number | null;
  store_name: string | null;
  price_at_interaction: number | null;
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
export type ClientInteraction =
  | "scanned"
  | "viewed"
  | "viewed-from-search"
  | "viewed-from-recommendation";

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
export async function getMyProduct(productId: number, storeId?: number): Promise<MyProduct> {
  const response = await authenticatedFetch(withStore(`/api/me/products/${productId}`, storeId));
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
  storeId?: number;
} = {}): Promise<LikedProductPage> {
  const response = await authenticatedFetch(
    `/api/me/liked-products${queryString({
      q: options.query,
      sort: options.sort,
      store_id: options.storeId,
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
  storeId?: number;
} = {}): Promise<HistoryPage> {
  const response = await authenticatedFetch(
    `/api/me/product-history${queryString({
      q: options.query,
      store_id: options.storeId,
      limit: options.limit,
      cursor: options.cursor,
    })}`,
  );
  return readJson(response, "Could not load your history");
}

// Both calls are idempotent, so repeating one is harmless.
export async function likeProduct(productId: number, storeId?: number): Promise<MyProduct> {
  const response = await authenticatedFetch(withStore(`/api/me/liked-products/${productId}`, storeId), {
    method: "PUT",
  });
  return readJson(response, "Could not like the product");
}

export async function unlikeProduct(productId: number, storeId?: number): Promise<MyProduct> {
  const response = await authenticatedFetch(withStore(`/api/me/liked-products/${productId}`, storeId), {
    method: "DELETE",
  });
  return readJson(response, "Could not remove the like");
}

// Records that the user scanned or opened a product, for the History tab.
export async function recordInteraction(
  productId: number,
  interaction: ClientInteraction,
  storeId?: number,
): Promise<void> {
  const response = await authenticatedFetch(withStore("/api/me/product-interactions", storeId), {
    method: "POST",
    body: JSON.stringify({ product_id: productId, interaction }),
  });
  if (!response.ok) {
    throw new Error(`Could not record the interaction (error ${response.status})`);
  }
}


// The shopper's account-level default, or null if unset.
export async function getHomeStore(signal?: AbortSignal): Promise<number | null> {
  const response = await authenticatedFetch("/api/me/store", { signal });
  const body = await readJson<{ store_id: number | null }>(response, "Could not load your store");
  return body.store_id;
}

export async function saveHomeStore(
  storeId: number | null,
  { onlyIfUnset = false, signal }: { onlyIfUnset?: boolean; signal?: AbortSignal } = {},
): Promise<number | null> {
  const path = onlyIfUnset ? "/api/me/store?only_if_unset=true" : "/api/me/store";
  const response = await authenticatedFetch(path, {
    method: "PUT",
    body: JSON.stringify({ store_id: storeId }),
    signal,
  });
  const body = await readJson<{ store_id: number | null }>(response, "Could not save your store");
  return body.store_id;
}
// --- Recent searches (signed-in shoppers) --------------------------------------

export type RecentSearch = { search_id: number; query: string; searched_at: string };

export async function listRecentSearches(): Promise<RecentSearch[]> {
  const response = await authenticatedFetch("/api/me/recent-searches");
  return readJson(response, "Could not load your recent searches");
}

// Saves a search that just ran. Never worth bothering the shopper about if it fails.
export async function recordRecentSearch(query: string): Promise<void> {
  await authenticatedFetch("/api/me/recent-searches", {
    method: "POST",
    body: JSON.stringify({ query }),
  }).catch(() => undefined);
}

export async function deleteRecentSearch(searchId: number): Promise<void> {
  await authenticatedFetch(`/api/me/recent-searches/${searchId}`, { method: "DELETE" });
}

export async function clearRecentSearches(): Promise<void> {
  await authenticatedFetch("/api/me/recent-searches", { method: "DELETE" });
}
