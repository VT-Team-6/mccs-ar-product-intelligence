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

// Like authenticatedFetch, but sends a FormData body (a file upload).
// The Content-Type header is deliberately not set: the browser and React Native
// have to add it themselves so it includes the multipart boundary, and setting
// it by hand makes the backend fail to parse the file.
export async function authenticatedFormFetch(
  path: string,
  form: FormData,
  options: RequestInit = {},
) {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new Error("User is not authenticated. Please log in.");
  }
  const { headers, ...rest } = options;
  return fetch(`${API_URL}${path}`, {
    ...rest,
    method: options.method ?? "POST",
    body: form,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
}
