import { authenticatedFetch } from "./client";
import type { Product } from "./products";
import type { Preferences } from "@/preferences/criteria";

// What the shopper asked for. Give a product, some text, or both.
export type RecommendationRequest = {
  product_id?: number;
  text?: string;
  // What matters right now (same ranks as Preferences: 1 = most, 0 = not ranked)
  ranking: Preferences;
};

// One recommended product and why it was picked
export type Recommendation = {
  product: Product;
  score: number;
  reasons: string[];
};

export type RecommendationResult = {
  best_matches: Recommendation[];
  // Uses saved preferences and likes too; null when the user has neither
  for_you: Recommendation | null;
};

export async function getRecommendations(request: RecommendationRequest): Promise<RecommendationResult> {
  const response = await authenticatedFetch("/api/recommendations", {
    method: "POST",
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`Could not get recommendations (error ${response.status})`);
  }
  return response.json();
}