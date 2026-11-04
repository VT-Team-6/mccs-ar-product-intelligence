// Rules for which products can be compared (task 18).
// Kept apart from the screen so they are easy to test and reuse when
// History gets its "select to compare" controls.

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

export type CompareSelection = {
  // Valid product ids, in the order they were picked, with repeats removed
  ids: number[];
  // Why the comparison can't be shown, or null when it can
  problem: string | null;
};

// Reads "3,7,12" from the page address. Anything that isn't a whole positive
// number is ignored, and picking the same product twice only counts once.
export function readSelection(param: string | undefined): CompareSelection {
  const ids: number[] = [];
  for (const part of (param ?? '').split(',')) {
    const text = part.trim();
    if (!/^\d+$/.test(text)) continue;
    const id = Number(text);
    if (id > 0 && !ids.includes(id)) ids.push(id);
  }
  return { ids, problem: selectionProblem(ids.length) };
}

// The message to show for a selection of this size, or null if it's fine
export function selectionProblem(count: number): string | null {
  if (count === 0) return `Pick at least ${MIN_COMPARE} products to compare.`;
  if (count < MIN_COMPARE) return `Pick at least one more product to compare.`;
  if (count > MAX_COMPARE) return `You can compare up to ${MAX_COMPARE} products at a time.`;
  return null;
}

// Builds the address of the comparison page for these products
export function compareHref(ids: number[]): string {
  return `/compare?ids=${ids.join(',')}`;
}