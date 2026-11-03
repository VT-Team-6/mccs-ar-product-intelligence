import { authenticatedFetch } from "./client";
import { readPreferences, type Preferences } from "@/preferences/criteria";

// The signed-in user's saved preferences. A user who has never saved any
// gets the defaults (everything Medium) from the backend.
export async function getPreferences(): Promise<Preferences> {
  const response = await authenticatedFetch("/api/me/preferences");
  if (!response.ok) {
    throw new Error(`Could not load your preferences (error ${response.status})`);
  }
  return readPreferences(await response.json());
}

// Replaces the user's preferences. Saving the same values twice is harmless.
export async function savePreferences(preferences: Preferences): Promise<Preferences> {
  const response = await authenticatedFetch("/api/me/preferences", {
    method: "PUT",
    body: JSON.stringify(preferences),
  });
  if (!response.ok) {
    throw new Error(`Could not save your preferences (error ${response.status})`);
  }
  return readPreferences(await response.json());
}