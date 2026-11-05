import { publicFetch } from "./client";

// One place the geocoder matched a ZIP code or city name to. This is a location,
// not a store: it only sets where distances are measured from.
export type LocationSuggestion = {
  id: number;
  /** Ready to show, e.g. "Quantico, Virginia, United States". */
  label: string;
  latitude: number;
  longitude: number;
};

type LocationSearchResponse = {
  locations: LocationSuggestion[];
};

// Turns typed text (a ZIP code or a city name) into coordinates.
// Public: no token needed. The backend answers 422 for a query under 2
// characters, 504 when the geocoder times out, and 502 when it fails; those
// messages are user-facing and are passed through as-is.
export async function searchLocations(query: string): Promise<LocationSuggestion[]> {
  const trimmed = query.trim();
  // The backend rejects anything shorter, so don't spend a request finding out.
  if (trimmed.length < 2) return [];

  const response = await publicFetch(
    `/api/stores/search?q=${encodeURIComponent(trimmed)}`,
  );
  if (!response.ok) {
    throw new Error(await problem(response));
  }
  const body = (await response.json()) as LocationSearchResponse;
  return Array.isArray(body?.locations) ? body.locations : [];
}

// Prefers the backend's own wording ("Location search timed out"), which is
// written to be shown to a shopper.
async function problem(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // Not JSON: fall through
  }
  return `Could not search for that location (error ${response.status})`;
}
