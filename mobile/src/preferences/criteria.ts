// The things a shopper can rank by how much they matter to them.
// Each criterion gets a rank: 1 = matters most, 2 = next, and so on. 0 = not ranked.
// The recommendation engine turns ranks into weights (#1 counts most, unranked count a little).

export type CriterionKey = 'price' | 'rating' | 'brand' | 'quality' | 'durability' | 'comfort';

export const CRITERIA: { key: CriterionKey; label: string; hint: string }[] = [
  { key: 'price', label: 'Price', hint: 'Prefer lower-priced products' },
  { key: 'rating', label: 'Rating', hint: 'Prefer products with higher ratings' },
  { key: 'brand', label: 'Brand', hint: 'Prefer brands you know and trust' },
  { key: 'quality', label: 'Quality', hint: 'Materials and how well it is made' },
  { key: 'durability', label: 'Durability', hint: 'How long it lasts with regular use' },
  { key: 'comfort', label: 'Comfort', hint: 'How it feels to wear or use' },
];

// Each criterion's rank (0 = not ranked)
export type Preferences = Record<CriterionKey, number>;

// Nothing ranked until the shopper picks something
export const DEFAULT_PREFERENCES: Preferences = {
  price: 0,
  rating: 0,
  brand: 0,
  quality: 0,
  durability: 0,
  comfort: 0,
};

// Tapping a criterion: an unranked one gets the next number. A ranked one is
// removed, and everything ranked below it moves up one, so ranks never have gaps.
export function toggleRank(preferences: Preferences, key: CriterionKey): Preferences {
  const current = preferences[key];
  const next = { ...preferences };

  if (current === 0) {
    next[key] = rankedCount(preferences) + 1;
    return next;
  }

  next[key] = 0;
  for (const { key: other } of CRITERIA) {
    if (next[other] > current) next[other] -= 1;
  }
  return next;
}

export function rankedCount(preferences: Preferences): number {
  return CRITERIA.filter(({ key }) => preferences[key] > 0).length;
}

// Ranks must be 1, 2, 3, ... with no repeats or gaps (the backend checks this too)
function isValidRanking(preferences: Preferences): boolean {
  const ranks = CRITERIA.map(({ key }) => preferences[key])
    .filter((rank) => rank > 0)
    .sort((a, b) => a - b);
  return ranks.every((rank, index) => rank === index + 1);
}

// Turns data from the backend into preferences. Anything missing or invalid
// falls back to nothing ranked, so a bad response can't break the screen.
export function readPreferences(data: unknown): Preferences {
  const result: Preferences = { ...DEFAULT_PREFERENCES };
  if (typeof data !== 'object' || data === null) return result;
  for (const { key } of CRITERIA) {
    const value = (data as Record<string, unknown>)[key];
    if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= CRITERIA.length) {
      result[key] = value as number;
    }
  }
  return isValidRanking(result) ? result : { ...DEFAULT_PREFERENCES };
}

export function samePreferences(a: Preferences, b: Preferences): boolean {
  return CRITERIA.every(({ key }) => a[key] === b[key]);
}