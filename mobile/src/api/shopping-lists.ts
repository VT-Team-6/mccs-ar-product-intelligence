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
};

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
export async function addShoppingListItem(
  listId: number,
  productId: number,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(
    `${BASE}/${listId}/items`,
    {
      method: 'POST',
      body: JSON.stringify({ product_id: productId }),
    },
  );
  return readResponse(response, 'Could not add product.');
}

// Manually check or uncheck an item.
export async function setShoppingListItemCompleted(
  listId: number,
  productId: number,
  isCompleted: boolean,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(
    `${BASE}/${listId}/items/${productId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ is_completed: isCompleted }),
    },
  );
  return readResponse(response, 'Could not update item.');
}

// Remove an item from one list.
export async function removeShoppingListItem(
  listId: number,
  productId: number,
): Promise<ShoppingList> {
  const response = await authenticatedFetch(
    `${BASE}/${listId}/items/${productId}`,
    { method: 'DELETE' },
  );
  return readResponse(response, 'Could not remove item.');
}
