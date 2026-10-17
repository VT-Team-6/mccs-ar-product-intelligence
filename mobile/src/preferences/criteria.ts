// The things a shopper can say matter to them, and how much.
// The recommendation and comparison code will use these levels as weights.

// 0 means the shopper doesn't care about this criterion at all
export type Importance = 0 | 1 | 2 | 3;

export const IMPORTANCE_LEVELS: { value: Importance; label: string }[] = [
  { value: 0, label: 'Skip' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
];

export type CriterionKey = 'price' | 'rating' | 'brand' | 'quality' | 'durability' | 'comfort';

export const CRITERIA: { key: CriterionKey; label: string; hint: string }[] = [
  { key: 'price', label: 'Price', hint: 'Prefer lower-priced products' },
  { key: 'rating', label: 'Rating', hint: 'Prefer products with higher ratings' },
  { key: 'brand', label: 'Brand', hint: 'Prefer brands you know and trust' },
  { key: 'quality', label: 'Quality', hint: 'Materials and how well it is made' },
  { key: 'durability', label: 'Durability', hint: 'How long it lasts with regular use' },
  { key: 'comfort', label: 'Comfort', hint: 'How it feels to wear or use' },
];

export type Preferences = Record<CriterionKey, Importance>;

// Everything starts at Medium until the shopper changes it
export const DEFAULT_PREFERENCES: Preferences = {
  price: 2,
  rating: 2,
  brand: 2,
  quality: 2,
  durability: 2,
  comfort: 2,
};

function isImportance(value: unknown): value is Importance {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

// Turns saved text back into preferences. Anything missing or invalid
// falls back to the default, so old or damaged saved data can't break the screen.
export function parsePreferences(raw: string | null): Preferences {
  const result: Preferences = { ...DEFAULT_PREFERENCES };
  if (!raw) return result;
  try {
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== 'object' || saved === null) return result;
    for (const { key } of CRITERIA) {
      const value = (saved as Record<string, unknown>)[key];
      if (isImportance(value)) result[key] = value;
    }
  } catch {
    // Not valid JSON, so use the defaults
  }
  return result;
}

export function samePreferences(a: Preferences, b: Preferences): boolean {
  return CRITERIA.every(({ key }) => a[key] === b[key]);
}