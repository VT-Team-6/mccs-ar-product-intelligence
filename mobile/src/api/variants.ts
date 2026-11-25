import { authenticatedFetch, publicFetch, withStore } from "./client";
import type { ProductImage } from "./products";

// One color/size a product comes in. A product with no options has a single
// variant with no color and no size. Stock fields are for the store asked about.
export type Variant = {
  variant_id: number;
  product_id: number;
  color: string | null;
  color_hex: string | null;
  // Second swatch color of a two-tone colorway ("White/Black")
  color_hex_2?: string | null;
  size: string | null;
  sku: string;
  quantity: number | null;
  price: number | string | null;
  in_stock: boolean;
};

// A variant on the staff inventory screen
export type StoreVariant = Variant & {
  label: string;
  low_stock: boolean;
  // The level this color/size uses, and its own level (null = the product's)
  low_stock_threshold: number;
  own_low_stock_threshold: number | null;
};

export type VariantColor = { name: string; hex: string | null; hex2?: string | null };
export type VariantOptions = {
  colors: VariantColor[];
  sizes: string[];
  // Combinations that don't exist, e.g. a colorway that doesn't come in size 6
  skip: { color: string | null; size: string | null }[];
};

async function problem(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return new Error(body.detail);
  } catch {
    // Not JSON
  }
  return new Error(`${fallback} (error ${response.status})`);
}

// "Black / 10", "Black", "12 oz", or "" for a product without options
export function variantLabel(variant: { color: string | null; size: string | null }): string {
  return [variant.color, variant.size].filter(Boolean).join(" / ");
}

export function hasOptions(variants: Variant[]): boolean {
  return variants.some((variant) => variant.color || variant.size);
}

// The colors in display order, once each
export function variantColors(variants: Variant[]): VariantColor[] {
  const seen = new Map<string, VariantColor>();
  for (const variant of variants) {
    if (variant.color && !seen.has(variant.color)) {
      seen.set(variant.color, {
        name: variant.color,
        hex: variant.color_hex,
        hex2: variant.color_hex_2 ?? null,
      });
    }
  }
  return [...seen.values()];
}

// The sizes in display order, once each
export function variantSizes(variants: Variant[]): string[] {
  const sizes: string[] = [];
  for (const variant of variants) {
    if (variant.size && !sizes.includes(variant.size)) sizes.push(variant.size);
  }
  return sizes;
}

// A variant's price as a number, or null
export function variantPrice(variant: Variant | null | undefined): number | null {
  if (!variant || variant.price == null) return null;
  const value = Number(variant.price);
  return Number.isFinite(value) ? value : null;
}

// Whether a photo shows this variant: a photo tagged with a color or size
// belongs to that one; an untagged photo belongs to all of them.
export function photoMatches(
  image: Pick<ProductImage, "color" | "size">,
  variant: { color: string | null; size: string | null } | null,
): boolean {
  if (!variant) return !image.color && !image.size;
  for (const option of ["color", "size"] as const) {
    const tag = image[option];
    if (tag && (variant[option] ?? "").toLowerCase() !== tag.toLowerCase()) return false;
  }
  return true;
}

// The product's colors and sizes with price and stock at the store
export async function getVariants(productId: number, storeId?: number): Promise<Variant[]> {
  const response = await publicFetch(withStore(`/api/products/${productId}/variants`, storeId));
  if (!response.ok) throw await problem(response, "Could not load the sizes and colors");
  return response.json();
}

export async function getAdminVariants(productId: number): Promise<Variant[]> {
  const response = await authenticatedFetch(`/api/admin/products/${productId}/variants`);
  if (!response.ok) throw await problem(response, "Could not load the sizes and colors");
  return response.json();
}

// Replaces the product's colors and sizes. Combinations that stay keep their stock.
export async function setVariantOptions(productId: number, options: VariantOptions): Promise<Variant[]> {
  const response = await authenticatedFetch(`/api/admin/products/${productId}/variants`, {
    method: "PUT",
    body: JSON.stringify(options),
  });
  if (!response.ok) throw await problem(response, "Could not save the sizes and colors");
  return response.json();
}

// Each color/size's stock and price at a store, for staff
export async function getStoreVariants(storeId: number, productId: number): Promise<StoreVariant[]> {
  const response = await authenticatedFetch(`/api/admin/inventory/${storeId}/products/${productId}/variants`);
  if (!response.ok) throw await problem(response, "Could not load the sizes and colors");
  return response.json();
}

// Sets the product's low-stock level and/or each color/size's own level at a
// store. A null level clears it, so that size uses the product's level again.
export async function setLowStockLevels(
  storeId: number,
  productId: number,
  change: {
    low_stock_threshold?: number;
    levels: { variant_id: number; low_stock_threshold: number | null }[];
  },
): Promise<StoreVariant[]> {
  const response = await authenticatedFetch(
    `/api/admin/inventory/${storeId}/products/${productId}/low-stock-levels`,
    { method: "PUT", body: JSON.stringify(change) },
  );
  if (!response.ok) throw await problem(response, "Could not save the low-stock levels");
  return response.json();
}

export async function updateVariantStock(
  variantId: number,
  storeId: number,
  change: { quantity?: number; price?: number },
): Promise<StoreVariant> {
  const response = await authenticatedFetch(`/api/admin/inventory/variants/${variantId}/${storeId}`, {
    method: "PUT",
    body: JSON.stringify(change),
  });
  if (!response.ok) throw await problem(response, "Could not save the stock");
  return response.json();
}

// Says which color or size a photo shows; both null makes it shared by all
export async function setImageOption(
  productId: number,
  imageId: number,
  option: { color: string | null; size: string | null },
): Promise<ProductImage[]> {
  const response = await authenticatedFetch(`/api/admin/products/${productId}/images/${imageId}/option`, {
    method: "PUT",
    body: JSON.stringify(option),
  });
  if (!response.ok) throw await problem(response, "Could not update the photo");
  return response.json();
}
