import { authenticatedFetch } from "./client";

// Uses the backend's message when it sends one
async function problem(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return new Error(body.detail);
  } catch {
    // Not JSON: fall through to the general message
  }
  return new Error(`${fallback} (error ${response.status})`);
}

// --- Reorders (managers) -------------------------------------------------------

// A low product's reorder status
//   open         needs reorder
//   requested    sent to a buyer, waiting
//   ordered      the buyer ordered it
//   unavailable  the buyer couldn't order it (see reason)
export type ReorderStatus = "open" | "requested" | "ordered" | "unavailable";

export type ReorderProduct = {
  alert_id: number;
  product_id: number;
  name: string;
  brand: string | null;
  quantity: number;
  low_stock_threshold: number;
  suggested_quantity: number;
  status: ReorderStatus;
  created_at: string;
  buyer_user_id: number | null;
  buyer_email: string | null;
  request_id: number | null;
  requested_quantity: number | null;
  requested_from: string | null;
  requested_at: string | null;
  reason: string | null;
  updated_at: string | null;
};

export type ReorderCounts = Record<ReorderStatus, number>;

export async function getReorders(
  storeId: number,
): Promise<{ products: ReorderProduct[]; counts: ReorderCounts }> {
  const response = await authenticatedFetch(`/api/reorders?store_id=${storeId}`);
  if (!response.ok) throw await problem(response, "Could not load the low-stock products");
  return response.json();
}

// Products that can be sent (needs reorder or unavailable) for one buyer.
// buyer_user_id is null for products with no buyer.
export type ReorderGroup = {
  buyer_user_id: number | null;
  buyer_email: string | null;
  items: ReorderProduct[];
};

export async function getReorderGroups(storeId: number): Promise<ReorderGroup[]> {
  const response = await authenticatedFetch(`/api/reorders/groups?store_id=${storeId}`);
  if (!response.ok) throw await problem(response, "Could not load the low-stock products");
  return response.json();
}

export async function sendOrderRequest(
  storeId: number,
  buyerUserId: number,
  items: { alert_id: number; quantity: number }[],
  note: string,
  rememberBuyer = false,
): Promise<void> {
  const response = await authenticatedFetch("/api/reorders/send", {
    method: "POST",
    body: JSON.stringify({
      store_id: storeId,
      buyer_user_id: buyerUserId,
      items,
      note,
      remember_buyer: rememberBuyer,
    }),
  });
  if (!response.ok) throw await problem(response, "Could not send the order request");
}

// --- Order requests (buyers) ---------------------------------------------------

export type ItemStatus = "pending" | "ordered" | "unavailable";

export type OrderSummary = {
  pending: number;
  ordered: number;
  unavailable: number;
  received: number;
  finished: boolean;
};

export type OrderRequest = {
  request_id: number;
  store_id: number;
  store_name: string;
  store_address: string;
  buyer_user_id: number | null;
  buyer_email: string | null;
  sent_by_email: string | null;
  note: string;
  created_at: string;
  // The formal Order Request text
  message: string;
  summary: OrderSummary;
  items: {
    product_id: number;
    name: string;
    brand: string | null;
    quantity: number;
    status: ItemStatus;
    reason: string;
    updated_at: string | null;
    current_quantity: number | null;
    restocked: boolean;
  }[];
};

export type OrderRequestListEntry = {
  request_id: number;
  store_id: number;
  store_name: string;
  sent_by_email: string | null;
  buyer_email: string | null;
  created_at: string;
  unread: boolean;
  product_count: number;
  summary: OrderSummary;
};

// The order requests sent to the signed-in buyer
export async function getMyOrderRequests(includeFinished = false): Promise<OrderRequestListEntry[]> {
  const response = await authenticatedFetch(`/api/order-requests?include_finished=${includeFinished}`);
  if (!response.ok) throw await problem(response, "Could not load your order requests");
  return response.json();
}

// A store's order requests, for its managers
export async function getStoreOrderRequests(
  storeId: number,
  includeFinished = false,
): Promise<OrderRequestListEntry[]> {
  const response = await authenticatedFetch(
    `/api/order-requests?store_id=${storeId}&include_finished=${includeFinished}`,
  );
  if (!response.ok) throw await problem(response, "Could not load the order requests");
  return response.json();
}

// A product in one of the buyer's order requests, for the By product view
export type BuyerItem = OrderRequest["items"][number] & {
  request_id: number;
  store_name: string;
  requested_at: string;
};

export async function getMyOrderItems(): Promise<BuyerItem[]> {
  const response = await authenticatedFetch("/api/order-requests/items");
  if (!response.ok) throw await problem(response, "Could not load your order items");
  return response.json();
}

// Opening a request also marks its notifications read
export async function getOrderRequest(requestId: number): Promise<OrderRequest> {
  const response = await authenticatedFetch(`/api/order-requests/${requestId}`);
  if (!response.ok) throw await problem(response, "Could not load the order request");
  return response.json();
}

// The buyer marks some products ordered, or unavailable with a reason
export async function updateOrderItems(
  requestId: number,
  productIds: number[],
  status: "ordered" | "unavailable",
  reason = "",
): Promise<OrderRequest> {
  const response = await authenticatedFetch(`/api/order-requests/${requestId}/items`, {
    method: "POST",
    body: JSON.stringify({ product_ids: productIds, status, reason }),
  });
  if (!response.ok) throw await problem(response, "Could not update the order request");
  return response.json();
}

// "3 ordered · 1 unavailable · 1 pending"
export function describeSummary(summary: OrderSummary): string {
  if (summary.finished && summary.unavailable === 0) return "Received";
  const parts = [
    summary.received > 0 && `${summary.received} received`,
    summary.ordered > 0 && `${summary.ordered} ordered`,
    summary.unavailable > 0 && `${summary.unavailable} unavailable`,
    summary.pending > 0 && `${summary.pending} pending`,
  ].filter(Boolean);
  return parts.join(" · ");
}

// --- Notifications -------------------------------------------------------------

export type Message = {
  message_id: number;
  kind: "low_stock" | "order_request" | "order_update";
  subject: string;
  body: string;
  store_id: number | null;
  request_id: number | null;
  created_at: string;
  read: boolean;
};

export async function getMessages(): Promise<{
  messages: Message[];
  unread: number;
  // Unread per store id, for managers of several stores
  unread_by_store: Record<string, number>;
}> {
  const response = await authenticatedFetch("/api/messages");
  if (!response.ok) throw await problem(response, "Could not load your messages");
  return response.json();
}

// Marks notifications read: these ids, one store's, or (with nothing) all
export async function markMessagesRead(which: { message_ids?: number[]; store_id?: number } = {}): Promise<void> {
  await authenticatedFetch("/api/messages/read", { method: "POST", body: JSON.stringify(which) });
}
