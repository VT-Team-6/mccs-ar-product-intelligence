// Shared pieces for advanced search: the request a shopper writes in their own
// words, plus an optional "what matters most" ranking.

import type { UnderstoodRequest } from '@/api/recommendations';
import { CRITERIA, DEFAULT_PREFERENCES, type CriterionKey, type Preferences } from '@/preferences/criteria';

// The backend accepts up to 200 characters of text for a recommendation
export const MAX_REQUEST_LENGTH = 200;

// Tapping one fills the box, so shoppers can see what kind of request works
export const EXAMPLE_REQUESTS = [
  'Waterproof hiking boots under $150',
  'Comfortable running shoes for long runs',
  'Something formal for a wedding',
];

// The ranking travels in the page address as the criteria in order,
// e.g. Comfort #1 and Price #2 becomes "comfort,price"
export function rankingToParam(ranking: Preferences): string {
  return CRITERIA.filter(({ key }) => ranking[key] > 0)
    .sort((a, b) => ranking[a.key] - ranking[b.key])
    .map(({ key }) => key)
    .join(',');
}

// Turns "comfort,price" back into a ranking. Unknown or repeated names are skipped.
export function rankingFromParam(param: string | undefined): Preferences {
  const ranking: Preferences = { ...DEFAULT_PREFERENCES };
  const known = new Set<string>(CRITERIA.map(({ key }) => key));
  let next = 1;
  for (const name of (param ?? '').split(',')) {
    if (known.has(name) && ranking[name as CriterionKey] === 0) {
      ranking[name as CriterionKey] = next;
      next += 1;
    }
  }
  return ranking;
}

// Short labels for how the search was read, e.g. ["Under $150", "Boot", "Waterproof"]
export function describeUnderstood(understood: UnderstoodRequest | null | undefined): string[] {
  if (!understood) return [];
  const money = (amount: number) => `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
  const labels: string[] = [];
  const { min_price: low, max_price: high } = understood;
  if (low !== null && high !== null) labels.push(`${money(low)} to ${money(high)}`);
  else if (high !== null) labels.push(`Under ${money(high)}`);
  else if (low !== null) labels.push(`Over ${money(low)}`);
  labels.push(...understood.brands);
  labels.push(...understood.product_types);
  labels.push(...understood.requirements.map((r) => r.charAt(0).toUpperCase() + r.slice(1)));
  return labels;
}