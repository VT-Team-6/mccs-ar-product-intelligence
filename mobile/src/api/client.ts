import { fetchAuthSession } from "aws-amplify/auth";
import { API_URL } from "./config";

// Fetch helper which requires the user to be authenticated, and passes in the tokens to the backend
export async function authenticatedFetch(
  path: string,
  options: RequestInit = {},
) {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new Error("User is not authenticated. Please log in.");
  }
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

// Fetch helper for API calls that don't need authentication
export async function publicFetch(path: string, options: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}
