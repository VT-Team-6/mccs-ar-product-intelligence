import { authenticatedFetch } from "./client";
import { API_URL } from "./config";

export type Role = "user" | "store_buyer" | "store_admin" | "system_admin";
export type StaffRole = "store_buyer" | "store_admin";

export type Permission =
  | "manage_stock"
  | "manage_inventory"
  | "manage_products"
  | "aggregate_reviews"
  | "manage_all_stores"
  | "manage_store_buyers"
  | "manage_store_admins";

export type User = {
  user_id: number;
  cognito_sub: string;
  email: string;
  role: Role;
  permissions: Permission[];
  store_ids: number[];
};

export async function getUser(): Promise<User> {
  console.log(API_URL);
  const response = await authenticatedFetch("/me");
  if (!response.ok) {
    throw new Error(`Could not fetch user: (error ${response.status})`);
  }
  const user = await response.json();
  console.log(user);
  return user;
}
