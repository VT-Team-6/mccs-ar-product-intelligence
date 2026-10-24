import { fetchAuthSession } from "aws-amplify/auth";

import { API_URL } from "./config";

// The review-provider format is shared by Amazon and future review sources.
export type ReviewCandidate = {
  source_product_id: string;
  title: string;
  description: string | null;
  url: string | null;
  review_count: number | null;
};

export type SavedReviewSource = {
  review_source_id: number;
  source: string;
  source_product_id: string;
  source_url: string | null;
  last_fetched_at: string | null;
};

export type ReviewImportResult = {
  product_id: number;
  source_count: number;
  available_reviews: number;
  imported_reviews: number;
};

// Review-admin routes require a Cognito access token (unlike some older product routes).
async function reviewRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const session = await fetchAuthSession();
  const accessToken = session.tokens?.accessToken?.toString();
  if (!accessToken) throw new Error("Please sign in to manage review sources.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status}).`;
    try {
      const data: { detail?: string | Array<{ msg?: string }> } =
        await response.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) {
        message = data.detail
          .map((entry) => entry.msg ?? "Invalid request")
          .join("; ");
      }
    } catch {
      // Keep the HTTP error if the backend returned a non-JSON response.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function searchReviewCandidates(
  productId: number,
  query?: string,
  source = "amazon",
): Promise<ReviewCandidate[]> {
  const params = [`source=${encodeURIComponent(source)}`];
  if (query?.trim()) params.push(`query=${encodeURIComponent(query.trim())}`);
  const result = await reviewRequest<{ candidates: ReviewCandidate[] }>(
    `/api/admin/products/${productId}/review-candidates?${params.join("&")}`,
  );
  return result.candidates;
}

export async function getReviewSources(
  productId: number,
  source?: string,
): Promise<SavedReviewSource[]> {
  const query = source ? `?source=${encodeURIComponent(source)}` : "";
  const result = await reviewRequest<{ sources: SavedReviewSource[] }>(
    `/api/admin/products/${productId}/review-sources${query}`,
  );
  return result.sources;
}

export async function saveReviewSources(
  productId: number,
  source: string,
  sourceProductIds: string[],
): Promise<SavedReviewSource[]> {
  const result = await reviewRequest<{ sources: SavedReviewSource[] }>(
    `/api/admin/products/${productId}/review-sources`,
    {
      method: "PUT",
      body: JSON.stringify({ source, source_product_ids: sourceProductIds }),
    },
  );
  return result.sources;
}

export async function importProductReviews(
  productId: number,
): Promise<ReviewImportResult> {
  return reviewRequest<ReviewImportResult>(
    `/api/admin/products/${productId}/import-reviews`,
    { method: "POST" },
  );
}
