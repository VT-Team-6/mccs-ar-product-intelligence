import { publicFetch, authenticatedFetch } from "./client";
import { API_URL } from "./config";

export type User = {
  user_id: number;
  cognito_sub: string;
  email: string;
  is_admin: boolean;
};

export async function getUser(): Promise<User> {
  console.log(API_URL);
  const response = await authenticatedFetch("/me");
  if (!response.ok) {
    throw new Error(`Could not fetch user: (error ${response.status})`);
  }
  console.log(response.json());
  return response.json();
}

// we can remove this later, it's just for testing purposes since we don't have the admin stuff setup yet
export async function adminTest(): Promise<User> {
  const response = await authenticatedFetch("/admin_test");

  if (!response.ok) {
    throw new Error(
      `Could not fetch user, likely not admin: (error ${response.status})`,
    );
  }

  return response.json();
}
