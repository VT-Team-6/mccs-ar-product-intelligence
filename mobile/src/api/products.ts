import {
  authenticatedFetch,
  authenticatedFormFetch,
  publicFetch,
  withStore,
} from "./client";
import { API_URL } from "./config";
import type { User } from "./general";

// Lifecycle of a product at one store. Only 'active' is ever shown as sellable;
// 'discontinued' drives the discontinued screen; 'pending' is staff-only and
// never reaches a shopper response.
export type InventoryStatus = "pending" | "active" | "discontinued";

// Price and stock at one store. Null when the store has no row for the product
// different from "no store selected", which the client distinguishes from its own state.
export type StoreInventory = {
  store_id: number;
  price: number | null;
  quantity: number;
  in_stock: boolean;
  status: InventoryStatus;
};

// Matches what the backend sends for each product
export type Product = {
  product_id: number;
  name: string;
  brand: string | null;
  product_type: string;
  // Decides which ranking criteria apply; null for older products
  category?: ProductCategory | null;
  // Who a shoe is sized for; null for everything else
  fit?: ProductFit | null;
  rating: number | null;
  description: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  // The store that added it, or null for an MCCS catalog product
  created_by_store_id?: number | null;
  // Resolved by the backend for the shopper's active store; null when no store
  // was resolved or the store doesn't carry (or hasn't approved) the product.
  store_inventory?: StoreInventory | null;
};

// What the admin fills in when adding or editing a product.
// The ID and the dates are set by the backend, so they aren't here.
// No price: each store sets its own on its inventory row.
// Must match CATEGORIES in backend/categories.py
export const PRODUCT_CATEGORIES = [
  { value: "shoes", label: "Shoes" },
  { value: "backpacks", label: "Backpacks" },
  { value: "headphones", label: "Headphones" },
  { value: "shampoo", label: "Shampoo" },
  { value: "coffee", label: "Coffee" },
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]["value"];

// Who a shoe is sized for (shoes only). A men's 7 and a women's 7 are different
// shoes, so each fit is its own product; unisex shoes are listed as men's.
export const PRODUCT_FITS = [
  { value: "mens", label: "Men's" },
  { value: "womens", label: "Women's" },
  { value: "kids", label: "Kids" },
] as const;
export type ProductFit = (typeof PRODUCT_FITS)[number]["value"];

export function fitLabel(fit: ProductFit | null | undefined): string | null {
  return PRODUCT_FITS.find((choice) => choice.value === fit)?.label ?? null;
}

export type ProductInput = {
  name: string;
  brand: string | null;
  product_type: string;
  category: ProductCategory;
  fit: ProductFit | null;
  description: string | null;
  image_url?: string | null;
  // Only when adding: the store the product is for. It owns the product and the
  // product starts pending there. The app admin can leave it out.
  store_id?: number | null;
};

// The app admin can change any product; a store admin only their store's.
export function canEditProduct(
  profile: User | null,
  product: Product,
): boolean {
  if (!profile) return false;
  if (profile.permissions.includes("manage_products")) return true;
  return (
    product.created_by_store_id != null &&
    profile.store_ids.includes(product.created_by_store_id)
  );
}

export async function listProducts(): Promise<Product[]> {
  const response = await authenticatedFetch("/api/admin/products");
  if (!response.ok) {
    throw new Error(`Could not load products (error ${response.status})`);
  }
  return response.json();
}

// Shopper search: products whose name, brand, type or description contain the text
export async function searchProducts(
  query: string,
  storeId?: number,
): Promise<Product[]> {
  const response = await publicFetch(
    withStore(`/api/search?q=${encodeURIComponent(query)}`, storeId),
  );
  if (!response.ok) {
    throw new Error(`Could not search products (error ${response.status})`);
  }
  return response.json();
}

export async function getProduct(productId: number): Promise<Product> {
  const response = await authenticatedFetch(`/api/admin/products/${productId}`);
  if (response.status === 404) {
    throw new Error("Product not found");
  }
  if (!response.ok) {
    throw new Error(`Could not load the product (error ${response.status})`);
  }
  return response.json();
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const response = await authenticatedFetch("/api/admin/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await problem(
      response,
      response.status === 422
        ? "The backend did not accept those values. Check the fields and try again."
        : `Could not add the product (error ${response.status})`,
    );
  }
  return response.json();
}

export async function updateProduct(
  productId: number,
  input: ProductInput,
): Promise<Product> {
  const response = await authenticatedFetch(
    `/api/admin/products/${productId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (response.status === 404) {
    throw new Error("Product not found");
  }
  if (response.status === 422) {
    throw new Error(
      "The backend did not accept those values. Check the fields and try again.",
    );
  }
  if (!response.ok) {
    throw new Error(`Could not save the product (error ${response.status})`);
  }
  return response.json();
}

export async function deleteProduct(productId: number): Promise<void> {
  const response = await authenticatedFetch(
    `/api/admin/products/${productId}`,
    {
      method: "DELETE",
    },
  );
  if (!response.ok) {
    throw new Error(`Could not delete the product (error ${response.status})`);
  }
}

// Uses the backend's message ("You can only add products for your own store")
// when it sends one
async function problem(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return new Error(body.detail);
  } catch {
    // Not JSON: use the general message
  }
  return new Error(fallback);
}

// Shopper-facing lookup: same product, but from the public endpoint
export async function getShopperProduct(
  productId: number,
  storeId?: number,
): Promise<Product> {
  const response = await publicFetch(
    withStore(`/api/products/${productId}`, storeId),
  );
  if (response.status === 404) {
    throw new Error("Product not found");
  }
  if (!response.ok) {
    throw new Error(`Could not load the product (error ${response.status})`);
  }
  return response.json();
}

// Turns a product's image_url into a full link the app can load.
// Paths like "/static/..." are files on our backend, so the backend address goes in front.
// Works for anything with an image_url: a product, or a store's inventory row
export function productImageUrl(product: {
  image_url?: string | null;
}): string | null {
  const imageUrl = product.image_url?.trim();
  if (!imageUrl) return null;
  return /^https?:\/\//i.test(imageUrl) ? imageUrl : `${API_URL}${imageUrl}`;
}

// The link to a product's QR code image, generated by the backend
export function productQrUrl(productId: number): string {
  return `${API_URL}/api/products/${productId}/qr`;
}

// --- Extra product images -------------------------------------------------

// One photo beyond the product's featured image. image_url is exactly what the
// backend stored, so it may be a full http(s) link or a /static/... path that
// productImageUrl() turns into a full link.
export type ProductImage = {
  image_id: number;
  image_url: string;
  // The color or size the photo shows (see constants/variants.ts); null for all
  color?: string | null;
  size?: string | null;
};

async function imageProblem(
  response: Response,
  fallback: string,
): Promise<Error> {
  // The backend explains duplicates, wrong file types and size limits in
  // "detail", which is more useful than a status code.
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return new Error(body.detail);
  } catch {
    // Not JSON: fall through to the general message
  }
  return new Error(fallback);
}

// The product's extra images, in the order they were added. Public: the
// product detail page reads this without needing admin access.
export async function listProductImages(
  productId: number,
): Promise<ProductImage[]> {
  const response = await publicFetch(`/api/products/${productId}/images`);
  if (response.status === 404) {
    throw new Error("Product not found");
  }
  if (!response.ok) {
    throw new Error(
      `Could not load the product's images (error ${response.status})`,
    );
  }
  return response.json();
}

// Add a photo by link. The backend refuses the featured image and repeats with 409.
export async function addProductImage(
  productId: number,
  imageUrl: string,
  option: { color?: string | null; size?: string | null } = {},
): Promise<ProductImage> {
  const response = await authenticatedFetch(
    `/api/admin/products/${productId}/images`,
    {
      method: "POST",
      body: JSON.stringify({ image_url: imageUrl.trim(), ...option }),
    },
  );
  if (response.status === 409) {
    throw new Error(
      "That image is already on this product. Choose a different photo.",
    );
  }
  if (response.status === 422) {
    throw new Error("Use a direct HTTP or HTTPS image URL.");
  }
  if (!response.ok) {
    throw await imageProblem(
      response,
      `Could not add the image (error ${response.status})`,
    );
  }
  return response.json();
}

// Upload a photo picked on the device. The backend stores it under
// /static/products and returns the link to show.
//
// The two platforms hand back different things, and FormData needs each in its
// own shape: web gives a File (append it directly), while React Native takes a
// {uri, name, type} object for a local file.
export type PickedImage = {
  uri: string;
  name?: string | null;
  type?: string | null;
  file?: File | null;
};

export async function uploadProductImage(
  productId: number,
  picked: PickedImage,
  option: { color?: string | null; size?: string | null } = {},
): Promise<ProductImage> {
  const form = new FormData();
  if (option.color) form.append("color", option.color);
  if (option.size) form.append("size", option.size);
  if (picked.file) {
    form.append("file", picked.file, picked.file.name);
  } else {
    form.append("file", {
      uri: picked.uri,
      name: picked.name || `product-${productId}.jpg`,
      type: picked.type || "image/jpeg",
    } as unknown as Blob);
  }

  const response = await authenticatedFormFetch(
    `/api/admin/products/${productId}/images/upload`,
    form,
  );
  if (response.status === 413) {
    throw new Error("That image is larger than 5 MB. Choose a smaller photo.");
  }
  if (response.status === 415) {
    throw new Error("Use a PNG, JPEG, WebP, or AVIF photo.");
  }
  if (!response.ok) {
    throw await imageProblem(
      response,
      `Could not upload the image (error ${response.status})`,
    );
  }
  return response.json();
}

// Remove one extra image. An uploaded photo's file is deleted with its row.
export async function deleteProductImage(
  productId: number,
  imageId: number,
): Promise<void> {
  const response = await authenticatedFetch(
    `/api/admin/products/${productId}/images/${imageId}`,
    { method: "DELETE" },
  );
  if (response.status === 404) {
    throw new Error("That image is no longer on this product.");
  }
  if (!response.ok) {
    throw await imageProblem(
      response,
      `Could not remove the image (error ${response.status})`,
    );
  }
}

// Promote an extra image to be the product's featured image. The backend swaps
// it with the current one, so the photo it replaces comes back in the gallery;
// it returns that gallery so the screen can show the result immediately.
export async function makeProductImageFeatured(
  productId: number,
  imageId: number,
): Promise<ProductImage[]> {
  const response = await authenticatedFetch(
    `/api/admin/products/${productId}/images/${imageId}/featured`,
    { method: "PUT" },
  );
  if (response.status === 404) {
    throw new Error("That image is no longer on this product.");
  }
  if (!response.ok) {
    throw await imageProblem(
      response,
      `Could not change the featured image (error ${response.status})`,
    );
  }
  return response.json();
}

// What the shopper should read where a price would go. The payload cannot tell
// "no store selected" from "this store doesn't carry it" (both are a null
// store_inventory), so the active store decides which copy is true.
export type StorePriceLine = {
  /** Context under the product details, e.g. "Price at MCCS Main Exchange location." */
  label: string;
  /** The right-hand price, e.g. "$89.99"; null when there is nothing to show. */
  price: string | null;
  /** Nothing is selected yet, so the label is a button that opens the selector. */
  needsStore: boolean;
};

// The price at the shopper's chosen store, or why there isn't one.
// `storeName`/`storeId` come from StoreContext: the payload carries only the id,
// and the name is what makes the copy truthful.
export function storePriceLine(
  product: Product,
  selectedStoreId: number | null,
  selectedStoreName: string | null,
): StorePriceLine {
  const inventory = product.store_inventory;

  // No store resolved at all: prompt for one rather than claiming the product
  // isn't sold anywhere.
  if (selectedStoreId === null) {
    return {
      label: "Select a store to view price and availability.",
      price: null,
      needsStore: true,
    };
  }

  // A response that names a different store is stale: the shopper switched
  // while it was in flight, so printing its price would be a lie.
  if (inventory && inventory.store_id !== selectedStoreId) {
    return { label: "Updating…", price: null, needsStore: false };
  }

  if (
    !inventory ||
    inventory.status === "discontinued" ||
    !inventory.in_stock ||
    inventory.price == null
  ) {
    return {
      label: "Unavailable at this location.",
      price: null,
      needsStore: false,
    };
  }

  const atStore = selectedStoreName ? ` at ${selectedStoreName} location` : "";
  return {
    label: `Price${atStore}.`,
    price: `$${inventory.price.toFixed(2)}`,
    needsStore: false,
  };
}

// The price at the chosen store as a number, or null when there isn't one.
// Never NaN: compare's badges rely on this being a real number or null.
export function storePriceValue(product: Product): number | null {
  const inventory = product.store_inventory;
  if (!inventory || inventory.status === "discontinued") return null;
  if (!inventory.in_stock) return null;
  const price = inventory.price;
  return typeof price === "number" && Number.isFinite(price) ? price : null;
}

// Stock at the shopper's chosen store, e.g. "In stock (12)"
export function storeStock(product: Product): string {
  const inventory = product.store_inventory;
  if (!inventory) return "Unavailable at this location.";
  if (inventory.status === "discontinued") return "Discontinued";
  return inventory.in_stock
    ? `In stock (${inventory.quantity})`
    : "Out of stock";
}
