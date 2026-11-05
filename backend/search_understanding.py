"""What the app shows the shopper about how their advanced search was read (task 12).

The recommendation engine already turns "waterproof hiking boots under $150"
into limits it applies (text_parsing.parse_request). This module puts that same
reading into a small, plain structure for the API response, so the results
screen can say "Under $150 · Waterproof · Hiking Shoe" and the shopper can check
the search was understood the way they meant it.
"""

from text_parsing import parse_request


def understand(text: str | None, brands: list[str], named_types: set[str]) -> dict | None:
    """The price range, brands, product types and requirements found in the text.

    ``named_types`` are the product types the engine matched in the text, passed in
    so this stays the same reading the engine used. Returns None for empty text.
    """
    text = (text or "").strip()
    if not text:
        return None
    parsed = parse_request(text, brands)
    return {
        "min_price": parsed.min_price,
        "max_price": parsed.max_price,
        "brands": sorted(parsed.brands),
        "product_types": sorted(named_types),
        "requirements": sorted(parsed.requirements),
    }