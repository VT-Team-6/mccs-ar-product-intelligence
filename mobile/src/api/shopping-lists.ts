import { authenticatedFetch } from './client';

// One item saved in a customer's shopping list.
export type ShoppingListItem = {
  shopping_list_item_id: number;
  product_id: number;
  is_completed: boolean;
  added_at: string;
  name: string;
  brand: string | null;
  product_type: string;
  image_url: string | null;
  // The color/size the shopper picked, or null for any. variant_color is set
  // for a color picked without a size too ("Black, any size")
  variant_id?: number | null;
  variant_color?: string | null;
  variant_size?: string | null;
  // How many, 1 to 99
  quantity?: number;
};

export const MAX_LIST_QUANTITY = 99;

// Whether a row is this product with this pick: exact size/color, a color in
// any size, or neither
export function samePick(
  item: ShoppingListItem,
  productId: number,
  variantId: number | null,
  color: string | null,
): boolean {
  if (item.product_id !== productId) return false;
  if (variantId !== null) return (item.variant_id ?? null) === variantId;
  return !item.variant_id && (item.variant_color ?? null) === color;
}

// Summary used when selecting a list.
export type ShoppingListSummary = {
  shopping_list_id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  total_items: number;
  completed_items: number;
};

// Full list including products.
export type ShoppingList = ShoppingListSummary & {
  items: ShoppingListItem[];
};

const BASE = '/api/me/shopping-lists';

async function readResponse<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  if (!response.ok) {
    let message = fallback;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') {
        message = body.detail;
      }
    } catch {
      // Use the fallback message.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

// Retrieve all lists belonging to the signed-in user.
export async function listShoppingLists(): Promise<ShoppingListSummary[]> {
  const response = await authenticatedFetch(BASE);
  return readResponse(response, 'Could not load shopping lists.');
}

// Create a new named shopping list.
export async function createShoppingList(
  name: string,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(BASE, {
    method: 'POST',
    body: JSON.stringify({ name: name.trim() }),
  });
  return readResponse(response, 'Could not create shopping list.');
}

// Retrieve one list and its items.
export async function getShoppingList(
  listId: number,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(`${BASE}/${listId}`);
  return readResponse(response, 'Could not load shopping list.');
}

// Set which list will be used by future scanning integration.
export async function activateShoppingList(
  listId: number,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(
    `${BASE}/${listId}/activate`,
    { method: 'PUT' },
  );
  return readResponse(response, 'Could not select shopping list.');
}

// Reusable by the product-details implementation.
// The same product and pick again adds to that row's quantity.
export async function addShoppingListItem(
  listId: number,
  productId: number,
  variantId?: number | null,
  color?: string | null,
  quantity = 1,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(
    `${BASE}/${listId}/items`,
    {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        variant_id: variantId ?? null,
        color: variantId ? null : (color ?? null),
        quantity,
      }),
    },
  );
  return readResponse(response, 'Could not add product.');
}

// Change how many of one row.
export async function setShoppingListItemQuantity(
  listId: number,
  itemId: number,
  quantity: number,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(`${BASE}/${listId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity }),
  });
  return readResponse(response, 'Could not change the quantity.');
}

// Manually check or uncheck one row (by its shopping_list_item_id).
export async function setShoppingListItemCompleted(
  listId: number,
  itemId: number,
  isCompleted: boolean,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(
    `${BASE}/${listId}/items/${itemId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ is_completed: isCompleted }),
    },
  );
  return readResponse(response, 'Could not update item.');
}

// Remove one row (by its shopping_list_item_id) from a list.
export async function removeShoppingListItem(
  listId: number,
  itemId: number,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(
    `${BASE}/${listId}/items/${itemId}`,
    { method: 'DELETE' },
  );
  return readResponse(response, 'Could not remove item.');
}

// What happened to the active list after a scan.
//   checked_off     it was on the list and is now checked off
//   already_checked it was on the list and already checked off
//   not_on_list     the active list doesn't have this product
//   no_active_list  the shopper has no active list
export type ScanCheckOffStatus =
  | 'checked_off'
  | 'already_checked'
  | 'not_on_list'
  | 'no_active_list';

export type ScanCheckOff = {
  status: ScanCheckOffStatus;
  product_id: number;
  // The updated active list, or null when there is none
  list: ShoppingList | null;
};

// Where one product stands on the active list, for the product page.
export type ActiveListStatus = {
  list_id: number | null;
  list_name: string | null;
  on_list: boolean;
  is_completed: boolean;
};

// Called after every scan: checks the product off the active list if it's on it.
export async function checkOffScanned(productId: number): Promise<ScanCheckOff> {
  const response = await authenticatedFetch(`${BASE}/active/scan`, {
    method: 'POST',
    body: JSON.stringify({ product_id: productId }),
  });
  return readResponse(response, 'Could not update your shopping list.');
}

// Whether a product is on the active list, and if it's checked off.
export async function getActiveListStatus(productId: number): Promise<ActiveListStatus> {
  const response = await authenticatedFetch(`${BASE}/active/products/${productId}`);
  return readResponse(response, 'Could not load your shopping list.');
}
