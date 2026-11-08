"""Product categories and the shopping criteria that make sense for each.

Every product belongs to one category. Durability and comfort only make sense
for things you wear or carry, so shampoo and coffee are ranked on the other
four criteria. Must match the CHECK in db/migrations/013-product-category.sql.
"""

import re

from preferences import CRITERIA

CATEGORIES = ("shoes", "backpacks", "headphones", "shampoo", "coffee")

_WEAR_OR_CARRY = CRITERIA  # price, rating, brand, quality, durability, comfort
_CONSUMABLE = ("price", "rating", "brand", "quality")

CATEGORY_CRITERIA: dict[str, tuple[str, ...]] = {
    "shoes": _WEAR_OR_CARRY,
    "backpacks": _WEAR_OR_CARRY,
    "headphones": _WEAR_OR_CARRY,
    "shampoo": _CONSUMABLE,
    "coffee": _CONSUMABLE,
}


# Words that say which category a search is about ("earbuds for running" is
# headphones, even though "running" sounds like shoes). Whole words only.
CATEGORY_WORDS: dict[str, tuple[str, ...]] = {
    "shoes": ("shoe", "shoes", "boot", "boots", "sneaker", "sneakers", "sandal", "sandals",
              "slipper", "slippers", "loafer", "loafers", "flip flops", "flip-flops", "clogs",
              "heels", "footwear", "trainers"),
    "backpacks": ("backpack", "backpacks", "bag", "bags", "daypack", "pack", "rucksack", "bookbag"),
    "headphones": ("headphone", "headphones", "earbud", "earbuds", "headset", "headsets",
                   "earphones", "airpods", "buds"),
    "shampoo": ("shampoo", "shampoos", "hair", "scalp", "dandruff"),
    "coffee": ("coffee", "espresso", "decaf", "roast"),
}


def categories_named_in(text: str | None) -> set[str]:
    """The categories a search names: "warm boots" -> {"shoes"}, "car tires" -> set()."""
    lower = (text or "").lower()
    return {
        category for category, words in CATEGORY_WORDS.items()
        if any(re.search(rf"\b{re.escape(word)}\b", lower) for word in words)
    }


def criteria_for(category: str | None) -> tuple[str, ...]:
    """The criteria for a category; all of them when it's unknown."""
    return CATEGORY_CRITERIA.get(category or "", CRITERIA)
