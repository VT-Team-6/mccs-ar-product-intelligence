import { authenticatedFetch, publicFetch } from "./client";

// Where a product is in a store's lifecycle: pushed and waiting for approval,
// on sale, or no longer sold there
export type InventoryStatus = "pending" | "active" | "discontinued";

// A location the shopper can pick. Mirrors the backend `Store` schema, so the
// coordinates are here even where a screen only shows the name and address.
export type Store = {
  store_id: number;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

// One product's stock at one store, as the inventory screen lists it
export type StoreStockEntry = {
  product_id: number;
  store_id: number;
  product_name: string;
  brand: string | null;
  quantity: number;
  price: number | null;
  in_stock: boolean;
  status: InventoryStatus;
  updated_at: string;
};

type StoreStockPage = {
  store_id: number;
  name: string;
  items: StoreStockEntry[];
  next_cursor: string | null;
};

// Uses the backend's message ("You don't have access...") when it sends one
async function problem(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return new Error(body.detail);
  } catch {
    // Not JSON: fall through to the general message
  }
  return new Error(`${fallback} (error ${response.status})`);
}

// Every store. The screen narrows this to the ones the user manages.
export async function listStores(): Promise<Store[]> {
  const response = await publicFetch("/api/stores");
  if (!response.ok) throw await problem(response, "Could not load stores");
  return response.json();
}

// One store that actively sells a product, with its own price and stock.
export type ProductStockEntry = {
  product_id: number;
  store_id: number;
  store_name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  quantity: number;
  price: number | null;
  in_stock: boolean;
  status: InventoryStatus;
  updated_at: string;
};

export type ProductStock = {
  product_id: number;
  name: string;
  // Every store with an active entry, including ones at quantity 0: those are
  // exactly the "available elsewhere" rows this is used for.
  stores: ProductStockEntry[];
};

// Where a product can be bought. Public: no token needed, and an unknown
// product is a 404 while a product sold nowhere is a 200 with no stores.
export async function getProductStock(productId: number): Promise<ProductStock> {
  const response = await publicFetch(`/api/products/${productId}/stock`);
  if (!response.ok) {
    throw await problem(response, "Could not load nearby stores");
  }
  return response.json();
}

// All of one store's entries with this status, following every page
export async function getStoreInventory(
  storeId: number,
  status: InventoryStatus,
): Promise<StoreStockEntry[]> {
  const items: StoreStockEntry[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({
      store_id: String(storeId),
      entry_status: status,
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);
    const response = await authenticatedFetch(`/api/admin/inventory?${params}`);
    if (!response.ok) throw await problem(response, "Could not load inventory");
    const page: StoreStockPage = await response.json();
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}

export type StockChange = {
  quantity?: number;
  price?: number;
  status?: InventoryStatus;
};

// Changes price, quantity and/or status of a product at a store
export async function updateStock(productId: number, storeId: number, change: StockChange) {
  const response = await authenticatedFetch(`/api/admin/inventory/${productId}/${storeId}`, {
    method: "PUT",
    body: JSON.stringify(change),
  });
  if (!response.ok) throw await problem(response, "Could not save the changes");
  return response.json();
}

// Approves a pushed product so shoppers can see it, with the store's price
export async function approveEntry(
  productId: number,
  storeId: number,
  values: { price: number; quantity: number },
) {
  const response = await authenticatedFetch(
    `/api/admin/inventory/${productId}/${storeId}/approve`,
    { method: "POST", body: JSON.stringify(values) },
  );
  if (!response.ok) throw await problem(response, "Could not approve the product");
  return response.json();
}

// Removes a product from a store. Declining a pushed product is exactly this.
export async function removeEntry(productId: number, storeId: number) {
  const response = await authenticatedFetch(`/api/admin/inventory/${productId}/${storeId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw await problem(response, "Could not remove the product");
  return response.json();
}