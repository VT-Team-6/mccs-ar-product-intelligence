# Tests for how an advanced search is summarized back to the shopper (task 12).
# No database or model needed: this only reads the text.

from search_understanding import understand

BRANDS = ["Nike", "Timberland", "Dr. Martens", "Merrell"]


def test_empty_text_gives_nothing():
    assert understand("", BRANDS, set()) is None
    assert understand("   ", BRANDS, set()) is None
    assert understand(None, BRANDS, set()) is None


def test_price_limit_and_requirement():
    result = understand("waterproof hiking boots under $150", BRANDS, {"Boot"})
    assert result == {
        "min_price": None,
        "max_price": 150,
        "brands": [],
        "product_types": ["Boot"],
        "requirements": ["waterproof"],
    }


def test_price_range():
    result = understand("sneakers between $50 and $100", BRANDS, {"Sneaker"})
    assert (result["min_price"], result["max_price"]) == (50, 100)


def test_brand_and_everyday_words():
    result = understand("Timberland boots for rain", BRANDS, {"Boot"})
    assert result["brands"] == ["Timberland"]
    assert result["requirements"] == ["waterproof"]


def test_plain_request_has_no_limits():
    result = understand("something comfortable for walking", BRANDS, set())
    assert result == {
        "min_price": None,
        "max_price": None,
        "brands": [],
        "product_types": [],
        "requirements": [],
    }


def test_lists_are_sorted_so_the_order_is_stable():
    result = understand("warm waterproof Nike or Merrell boots", BRANDS, {"Boot", "Rain Boot"})
    assert result["brands"] == ["Merrell", "Nike"]
    assert result["product_types"] == ["Boot", "Rain Boot"]
    assert result["requirements"] == ["insulated", "waterproof"]