import { publicFetch, withStore } from "@/api/client";
import { recordInteraction } from "@/api/me";
import { checkOffScanned } from "@/api/shopping-lists";

// What a scanned QR code turned out to be
export type ScanLookup =
  | { ok: true; productId: number }
  | { ok: false; message: string };

// Signed-in shoppers also get the scan in History and their active list updated.
export async function lookUpScannedCode(
  code: string,
  { signedIn, storeId }: { signedIn: boolean; storeId?: number },
): Promise<ScanLookup> {
  let response: Response;
  try {
    response = await publicFetch(withStore(`/api/scan?code=${encodeURIComponent(code)}`, storeId));
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

  if (signedIn) {
    recordInteraction(result.product_id, "scanned", storeId).catch(() => undefined);
    await checkOffScanned(result.product_id).catch(() => null);
  }
  return { ok: true, productId: result.product_id };
}
