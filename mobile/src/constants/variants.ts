import type { ProductCategory, ProductFit } from "@/api/products";

// Which options each category comes in. Must match OPTIONS in backend/variants.py
export const OPTIONS_FOR_CATEGORY: Record<ProductCategory, ("color" | "size")[]> = {
  shoes: ["color", "size"],
  backpacks: ["color"],
  headphones: ["color"],
  coffee: ["size"],
  shampoo: ["size"],
};

// Photos follow the option that changes how the product looks: a shoe looks
// the same in every size but not every color, while a bigger bag of coffee is
// a different package. Must match PHOTO_OPTION in backend/variants.py
export const PHOTO_OPTION: Record<ProductCategory, "color" | "size"> = {
  shoes: "color",
  backpacks: "color",
  headphones: "color",
  coffee: "size",
  shampoo: "size",
};

// Sizes offered as one-tap chips when setting up a product; any other size can be typed
export const SIZE_PRESETS: Partial<Record<ProductCategory, string[]>> = {
  shoes: ["6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13", "14", "15"],
  coffee: ["8 oz", "10 oz", "12 oz", "18 oz", "20 oz", "24 oz", "32 oz"],
  shampoo: ["4 fl oz", "8 fl oz", "12 fl oz", "13 fl oz", "25 fl oz", "28 fl oz"],
};

// Common colors with their swatch, offered as one-tap chips
export const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: "Black", hex: "#1A1A1A" },
  { name: "White", hex: "#F5F5F5" },
  { name: "Gray", hex: "#8A8F98" },
  { name: "Navy", hex: "#1F2A44" },
  { name: "Blue", hex: "#2F6FDE" },
  { name: "Red", hex: "#B3261E" },
  { name: "Green", hex: "#3E7D4F" },
  { name: "Brown", hex: "#7A5230" },
  { name: "Tan", hex: "#C8A27A" },
  { name: "Pink", hex: "#E58FB0" },
  { name: "Silver", hex: "#C9C9C9" },
];

export function optionsFor(category: ProductCategory | null | undefined): ("color" | "size")[] {
  return category ? OPTIONS_FOR_CATEGORY[category] ?? [] : [];
}

// US shoe sizes by fit. Kids runs from little kids (C) into big kids (Y).
const SHOE_SIZES_BY_FIT: Record<ProductFit, string[]> = {
  mens: ["6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13", "14", "15"],
  womens: ["5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "12"],
  kids: [
    "10.5C", "11C", "11.5C", "12C", "12.5C", "13C", "13.5C",
    "1Y", "1.5Y", "2Y", "2.5Y", "3Y", "3.5Y", "4Y", "4.5Y", "5Y", "5.5Y", "6Y", "6.5Y", "7Y",
  ],
};

// The size chips offered in the Colors & sizes editor
export function sizePresetsFor(
  category: ProductCategory | null | undefined,
  fit: ProductFit | null | undefined,
): string[] {
  if (!category) return [];
  if (category === "shoes" && fit) return SHOE_SIZES_BY_FIT[fit];
  return SIZE_PRESETS[category] ?? [];
}
