import { authenticatedFetch } from "@/api/client";
import { recordInteraction } from "@/api/me";
import { checkOffScanned } from "@/api/shopping-lists";

// What a scanned QR code turned out to be
export type ScanLookup =
  | { ok: true; productId: number }
  | { ok: false; message: string };

// Looks up a scanned QR code. On a match it also records the scan for History
// and checks the product off the active shopping list, so the product page
// already shows "Checked off your list". Neither of those ever blocks the
// product from opening.
export async function lookUpScannedCode(code: string): Promise<ScanLookup> {
  let response: Response;
  try {
    // Authenticated, so the backend prices the result at the saved store
    response = await authenticatedFetch(`/api/scan?code=${encodeURIComponent(code)}`);
  } catch {
    return { ok: false, message: "Couldn't reach the product server. Check your connection and try again." };
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      message: typeof result.detail === "string" ? result.detail : "That QR code isn't a product we know.",
    };
  }

  recordInteraction(result.product_id, "scanned").catch(() => undefined);
  await checkOffScanned(result.product_id).catch(() => null);
  return { ok: true, productId: result.product_id };
}
