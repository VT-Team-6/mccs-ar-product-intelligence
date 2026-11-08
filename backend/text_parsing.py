"""Pull price limits, brands and requirements out of what the shopper typed (task 6).

"waterproof boots under $100 from Timberland" ->
    max_price=100, brands={"Timberland"}, requirements={"waterproof"},
    remaining_text="waterproof boots from Timberland"

Price limits and brands are hard limits. Requirements only boost products that
mention them, since descriptions don't always say everything about a product.
"""

import re
from dataclasses import dataclass, field

# requirement -> (words the shopper might use, words a product's name/description would use)
REQUIREMENTS = {
    "waterproof": (
        ["waterproof", "water proof", "water resistant", "water-resistant", "rain", "rainy",
         "wet", "puddle", "puddles", "snow"],
        ["waterproof", "water-resistant", "water resistant", "gore-tex", "rain boot", "rain boots"],
    ),
    "insulated": (
        ["warm", "insulated", "winter", "cold", "freezing", "snow"],
        ["insulated", "winter", "warm", "fleece", "shearling", "lined"],
    ),
    # Words people use for what a product description calls something else
    "dark roast": (
        ["strong", "bold", "dark roast", "dark"],
        ["dark roast", "dark-roast", "espresso"],
    ),
    "oil control": (
        ["oily", "greasy"],
        ["oil control", "oil-control", "clarifying", "purifying"],
    ),
    "volume": (
        ["thin hair", "fine hair", "flat hair", "fuller", "thicker", "volume", "volumizing"],
        ["volumizing", "thickening", "thick & full", "volume"],
    ),
    "lightweight": (
        ["light", "lightweight", "light weight"],
        ["lightweight", "light"],
    ),
}

NUMBER = r"\$?\s*(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?"
MAX_PRICE = re.compile(rf"\b(?:under|below|less than|cheaper than|up to|at most|no more than|max)\s*{NUMBER}", re.I)
MIN_PRICE = re.compile(rf"\b(?:over|above|more than|at least|min)\s*{NUMBER}", re.I)
RANGE = re.compile(rf"(?:\bbetween\s*)?{NUMBER}\s*(?:-|to|and)\s*{NUMBER}", re.I)


@dataclass
class ParsedRequest:
    min_price: float | None = None
    max_price: float | None = None
    brands: set[str] = field(default_factory=set)
    requirements: set[str] = field(default_factory=set)
    remaining_text: str = ""


def _normalize(text: str) -> str:
    """Lowercase, punctuation to spaces: "Dr. Martens" -> "dr martens"."""
    return " ".join(re.sub(r"[^a-z0-9$]+", " ", (text or "").lower()).split())


def mentions(text: str, phrases: list[str]) -> bool:
    """Whole-word match, so "rain" doesn't match "trainer" or "Rainbow"."""
    normalized = f" {_normalize(text)} "
    return any(f" {_normalize(p)} " in normalized for p in phrases)


def _names_brand(text: str, brand: str) -> bool:
    """Whether the text names a brand. A brand of 2 letters or fewer, like "On",
    only counts with its capitals, so "headphones on a flight" isn't a brand."""
    if len(brand.strip()) <= 2:
        return re.search(rf"\b{re.escape(brand.strip())}\b", text or "") is not None
    return mentions(text, [brand])


def parse_request(text: str, brands: list[str]) -> ParsedRequest:
    parsed = ParsedRequest()
    remaining = text or ""

    # Price: a range first, then single limits; each phrase is removed once read
    if match := RANGE.search(remaining):
        low, high = sorted(float(n) for n in match.groups())
        parsed.min_price, parsed.max_price = low, high
        remaining = remaining.replace(match.group(0), " ")
    if match := MAX_PRICE.search(remaining):
        parsed.max_price = float(match.group(1))
        remaining = remaining.replace(match.group(0), " ")
    if match := MIN_PRICE.search(remaining):
        parsed.min_price = float(match.group(1))
        remaining = remaining.replace(match.group(0), " ")

    parsed.brands = {b for b in brands if _names_brand(remaining, b)}
    parsed.requirements = {name for name, (asks, _) in REQUIREMENTS.items() if mentions(remaining, asks)}
    parsed.remaining_text = " ".join(remaining.split())
    return parsed