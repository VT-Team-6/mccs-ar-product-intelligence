from text_parsing import mentions, parse_request

BRANDS = ["Nike", "Timberland", "Dr. Martens"]


def test_price_limits():
    assert parse_request("boots under $100", BRANDS).max_price == 100
    assert parse_request("less than 80 dollars", BRANDS).max_price == 80
    assert parse_request("over $150", BRANDS).min_price == 150
    both = parse_request("between 50 and 100", BRANDS)
    assert (both.min_price, both.max_price) == (50, 100)
    dash = parse_request("$100-$50 sneakers", BRANDS)
    assert (dash.min_price, dash.max_price) == (50, 100)


def test_price_phrases_are_removed_from_the_text():
    assert parse_request("waterproof boots under $100", BRANDS).remaining_text == "waterproof boots"


def test_brands_match_whole_names_ignoring_punctuation():
    assert parse_request("dr martens boots", BRANDS).brands == {"Dr. Martens"}
    assert parse_request("NIKE running", BRANDS).brands == {"Nike"}
    assert parse_request("running shoes", BRANDS).brands == set()


def test_requirements_from_everyday_words():
    assert parse_request("something for rain", BRANDS).requirements == {"waterproof"}
    assert "insulated" in parse_request("warm winter boots", BRANDS).requirements
    assert parse_request("running shoes", BRANDS).requirements == set()


def test_mentions_is_whole_word():
    assert mentions("Waterproof rubber rain boot", ["rain"])
    assert not mentions("Smooth daily trainer", ["rain"])
    assert not mentions("Rainbow Premier Leather Sandals", ["rain"])