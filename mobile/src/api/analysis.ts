import { API_URL } from './config';

// Matches the structured response from our backend
export type ProductAnalysis = {
  product_id: number;
  summary: string | null;
  pros: string[];
  cons: string[];
  review_count: number;
  sources: string[];
  message?: string;
};

// Fetch AI-generated review analysis for a product
export async function getProductAnalysis(
  productId: number
): Promise<ProductAnalysis> {
  const response = await fetch(
    `${API_URL}/api/products/${productId}/analysis`
  );

  if (response.status === 404) {
    throw new Error('Product not found');
  }

  if (response.status === 502) {
    throw new Error('AI analysis returned an invalid response. Please try again.');
  }

  if (response.status === 503) {
    throw new Error('AI analysis is temporarily unavailable. Please try again later.');
  }

  if (!response.ok) {
    throw new Error(`Could not load AI analysis (error ${response.status})`);
  }

  return response.json();
}