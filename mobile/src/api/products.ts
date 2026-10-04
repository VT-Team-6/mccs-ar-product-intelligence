import { API_URL } from './config';

// Matches what the backend sends for each product
export type Product = {
  product_id: number;
  name: string;
  brand: string | null;
  product_type: string;
  price: number | null;
  rating: number | null;
  description: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

export async function listProducts(): Promise<Product[]> {
  const response = await fetch(`${API_URL}/api/admin/products`);
  if (!response.ok) {
    throw new Error(`Could not load products (error ${response.status})`);
  }
  return response.json();
}


// Turns a product's image_url into a full link the app can load.
// Paths like "/static/..." are files on our backend, so the backend address goes in front.
export function productImageUrl(product: Product): string | null {
  if (!product.image_url) return null;
  return product.image_url.startsWith('http') ? product.image_url : `${API_URL}${product.image_url}`;
}