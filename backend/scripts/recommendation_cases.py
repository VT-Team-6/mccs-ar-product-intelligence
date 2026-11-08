"""Test set for the recommendation engine (task 10): searches and products with
graded expected results, so changes are measured instead of eyeballed.

Each case has rules from best to worst. A product gets the grade of the first
rule it matches, or 0:
    3 = exactly what was asked for
    2 = a good alternative
    1 = the right category, but not what was asked for
    0 = wrong (a shoe for a coffee search)
A case with no rules expects nothing to be shown (an unrelated search).

Rules look at a product's name + description (lowercase), type, category and
average price. Keep expectations about what a shopper would want, not about
what the engine currently returns.
"""

from dataclasses import dataclass, field
from typing import Callable

Rule = Callable[[dict], bool]


# --- rule helpers --------------------------------------------------------------


def text_of(p: dict) -> str:
    return f"{p['name']} {p.get('description') or ''}".lower()


def category(*names: str) -> Rule:
    return lambda p: p.get("category") in names


def ptype(*names: str) -> Rule:
    return lambda p: p["product_type"] in names


def words(*options: str) -> Rule:
    """Any of these words or phrases appear in the name or description."""
    return lambda p: any(option in text_of(p) for option in options)


def named(*names: str) -> Rule:
    """The product's name contains one of these."""
    return lambda p: any(name.lower() in p["name"].lower() for name in names)


def under(price: float) -> Rule:
    return lambda p: p.get("price") is not None and float(p["price"]) <= price


def all_of(*rules: Rule) -> Rule:
    return lambda p: all(rule(p) for rule in rules)


@dataclass
class Case:
    name: str
    text: str | None = None
    product: str | None = None       # name of the product being viewed
    ranks: dict | None = None        # criteria ranked for this request
    grades: list[tuple[int, Rule]] = field(default_factory=list)

    @property
    def expects_nothing(self) -> bool:
        return not self.grades

    def grade(self, product: dict) -> int:
        return next((g for g, rule in self.grades if rule(product)), 0)


SHOES = category("shoes")
BACKPACKS = category("backpacks")
HEADPHONES = category("headphones")
SHAMPOO = category("shampoo")
COFFEE = category("coffee")
PRICE_FIRST = {"price": 1, "rating": 0, "brand": 0, "quality": 0, "durability": 0, "comfort": 0}

EARBUDS = words("earbud", "in-ear", "airpods", "buds")
OVER_EAR = words("over-ear", "on-ear")
NOISE_CANCELLING = words("noise cancel", "noise-cancel")
LAPTOP = words("laptop")
DARK = words("dark-roast", "dark roast", "espresso")
DRY_HAIR = words("moistur", "dry hair", "hydrate", "all soft")
DANDRUFF = words("dandruff", "medicated", "scalp")

CASES: list[Case] = [
    # --- shoes: clear searches ---------------------------------------------
    Case("running shoes", text="running shoes",
         grades=[(3, ptype("Running Shoe")), (2, ptype("Trail Shoe", "Sneaker")), (1, SHOES)]),
    Case("warm winter boots", text="warm boots for snow",
         grades=[(3, named("Sorel", "UGG")), (2, words("waterproof", "boot")), (1, SHOES)]),
    Case("rain boots", text="rain boots",
         grades=[(3, ptype("Rain Boot", "Kids Rain Boot")), (2, all_of(SHOES, words("waterproof"))), (1, SHOES)]),
    Case("dry feet in the rain", text="something to keep my feet dry in the rain",
         grades=[(3, ptype("Rain Boot", "Kids Rain Boot")), (2, all_of(SHOES, words("waterproof"))), (1, SHOES)]),
    Case("hiking shoes", text="hiking shoes",
         grades=[(3, ptype("Hiking Shoe", "Hiking Boot", "Trail Shoe")), (2, all_of(SHOES, words("waterproof", "trail"))), (1, SHOES)]),
    Case("beach sandals", text="sandals for the beach",
         grades=[(3, ptype("Sandal", "Flip-Flop", "Water Shoe")), (1, SHOES)]),
    Case("wedding shoes", text="formal shoes for a wedding",
         grades=[(3, ptype("Dress Shoe")), (2, ptype("Loafer", "Flat")), (1, SHOES)]),
    Case("white leather sneakers", text="classic white leather sneakers",
         grades=[(3, named("Stan Smith", "Air Force 1", "Achilles", "Veja", "Club C")), (2, ptype("Sneaker")), (1, SHOES)]),
    Case("basketball shoes", text="basketball shoes",
         grades=[(3, ptype("Basketball Shoe")), (2, ptype("Sneaker")), (1, SHOES)]),
    Case("house slippers", text="slippers for around the house",
         grades=[(3, ptype("Slipper")), (2, named("UGG", "Moccasin", "Crocs")), (1, SHOES)]),
    Case("water shoes", text="water shoes for the pool",
         grades=[(3, ptype("Water Shoe")), (2, ptype("Sandal", "Flip-Flop")), (1, SHOES)]),
    Case("climbing shoes", text="rock climbing shoes",
         grades=[(3, ptype("Climbing Shoe")), (1, SHOES)]),
    Case("skate shoes", text="skate shoes",
         grades=[(3, ptype("Skate Shoe")), (2, ptype("Sneaker")), (1, SHOES)]),
    Case("work boots", text="sturdy work boots",
         grades=[(3, named("Red Wing", "Timberland", "Carhartt")), (2, ptype("Boot", "Hiking Boot")), (1, SHOES)]),
    Case("kids rain boots", text="rain boots for my kid",
         grades=[(3, ptype("Kids Rain Boot")), (2, ptype("Rain Boot")), (1, SHOES)]),
    Case("loafers", text="loafers for the office",
         grades=[(3, ptype("Loafer")), (2, ptype("Dress Shoe", "Moccasin", "Flat")), (1, SHOES)]),

    # --- shoes: vaguer searches --------------------------------------------
    Case("on my feet all day", text="comfortable shoes for standing all day",
         grades=[(2, ptype("Running Shoe", "Sneaker", "Clog")), (1, SHOES)]),
    Case("something for summer", text="something light for summer",
         grades=[(2, ptype("Sandal", "Flip-Flop", "Slip-On", "Water Shoe")), (1, SHOES)]),

    # --- shoes: with limits and requirements ---------------------------------
    Case("running shoes under $130", text="running shoes under $130",
         grades=[(3, all_of(ptype("Running Shoe"), under(130))), (1, all_of(SHOES, under(130)))]),
    Case("waterproof boots", text="waterproof boots",
         grades=[(3, all_of(SHOES, words("waterproof"), words("boot"))), (2, all_of(SHOES, words("waterproof"))), (1, SHOES)]),
    Case("Nike running shoes", text="nike running shoes",
         grades=[(3, all_of(named("Nike"), ptype("Running Shoe"))), (2, ptype("Running Shoe")), (1, SHOES)]),

    # --- backpacks ------------------------------------------------------------
    Case("laptop backpack", text="laptop backpack",
         grades=[(3, all_of(BACKPACKS, LAPTOP)), (2, all_of(BACKPACKS, words("business", "work", "commut"))), (1, BACKPACKS)]),
    Case("school bag", text="backpack for school",
         grades=[(3, all_of(BACKPACKS, words("school", "student", "campus"))), (1, BACKPACKS)]),
    Case("hiking daypack", text="small pack for day hikes",
         grades=[(3, all_of(BACKPACKS, words("hik", "daypack"))), (2, all_of(BACKPACKS, words("travel", "outing"))), (1, BACKPACKS)]),
    Case("travel backpack", text="backpack for a weekend trip",
         grades=[(3, all_of(BACKPACKS, words("travel"))), (1, BACKPACKS)]),
    Case("gym bag", text="bag for the gym",
         grades=[(3, all_of(BACKPACKS, words("gym", "workout", "athletic", "sports", "practice"))), (1, BACKPACKS)]),
    Case("work commute bag", text="professional bag for my commute to the office",
         grades=[(3, all_of(BACKPACKS, words("business", "commut"))), (2, all_of(BACKPACKS, LAPTOP)), (1, BACKPACKS)]),
    Case("mini backpack", text="tiny backpack for just a few things",
         grades=[(3, all_of(BACKPACKS, words("mini", "compact", "small"))), (1, BACKPACKS)]),
    Case("cheap school backpack", text="school backpack under $40",
         grades=[(3, all_of(BACKPACKS, under(40), words("school", "student", "everyday"))), (2, all_of(BACKPACKS, under(40)))]),

    # --- headphones -----------------------------------------------------------
    Case("noise cancelling headphones", text="noise cancelling headphones",
         grades=[(3, all_of(HEADPHONES, NOISE_CANCELLING)), (2, all_of(HEADPHONES, OVER_EAR)), (1, HEADPHONES)]),
    Case("wireless earbuds", text="wireless earbuds",
         grades=[(3, all_of(HEADPHONES, EARBUDS, words("wireless"))), (2, all_of(HEADPHONES, EARBUDS)), (1, HEADPHONES)]),
    Case("earbuds for running", text="earbuds for running at the gym",
         grades=[(3, all_of(HEADPHONES, EARBUDS, words("sport", "run"))), (2, all_of(HEADPHONES, EARBUDS)), (1, HEADPHONES)]),
    Case("gaming headset", text="gaming headset",
         grades=[(3, all_of(HEADPHONES, words("gaming"))), (2, all_of(HEADPHONES, words("headset", "microphone"))), (1, HEADPHONES)]),
    Case("headset for work calls", text="headset for work calls on my computer",
         grades=[(3, all_of(HEADPHONES, words("headset"), words("call", "usb"))), (2, all_of(HEADPHONES, words("microphone"))), (1, HEADPHONES)]),
    Case("cheap wired earbuds", text="cheap wired earbuds",
         grades=[(3, all_of(HEADPHONES, EARBUDS, words("wired"), under(25))), (2, all_of(HEADPHONES, words("wired"))), (1, HEADPHONES)]),
    Case("headphones for the plane", text="headphones to block out noise on a flight",
         grades=[(3, all_of(HEADPHONES, NOISE_CANCELLING)), (2, all_of(HEADPHONES, OVER_EAR)), (1, HEADPHONES)]),
    Case("bass headphones", text="headphones with lots of bass",
         grades=[(3, all_of(HEADPHONES, words("bass"))), (1, HEADPHONES)]),
    Case("headphones under $50", text="headphones under $50",
         grades=[(3, all_of(HEADPHONES, under(50))), (0, HEADPHONES)]),
    Case("iphone earbuds", text="earbuds for my iphone",
         grades=[(3, named("Apple")), (2, all_of(HEADPHONES, EARBUDS)), (1, HEADPHONES)]),

    # --- shampoo ----------------------------------------------------------------
    Case("dandruff shampoo", text="anti dandruff shampoo",
         grades=[(3, all_of(SHAMPOO, DANDRUFF)), (1, SHAMPOO)]),
    Case("itchy scalp", text="something for my itchy flaky scalp",
         grades=[(3, all_of(SHAMPOO, DANDRUFF)), (1, SHAMPOO)]),
    Case("dry hair shampoo", text="shampoo for dry hair",
         grades=[(3, all_of(SHAMPOO, DRY_HAIR)), (1, SHAMPOO)]),
    Case("curly hair", text="shampoo for curly hair",
         grades=[(3, all_of(SHAMPOO, words("curl"))), (2, all_of(SHAMPOO, DRY_HAIR)), (1, SHAMPOO)]),
    Case("thin hair volume", text="shampoo to make thin hair look fuller",
         grades=[(3, all_of(SHAMPOO, words("volum", "thicken", "thick & full", "fine or flat"))), (1, SHAMPOO)]),
    Case("color treated hair", text="shampoo for color treated hair",
         grades=[(3, all_of(SHAMPOO, words("color"))), (1, SHAMPOO)]),
    Case("oily hair", text="shampoo for oily hair",
         grades=[(3, all_of(SHAMPOO, words("oil control", "clarifying", "purifying", "pure clean"))), (1, SHAMPOO)]),
    Case("frizzy hair", text="frizz control shampoo",
         grades=[(3, all_of(SHAMPOO, words("frizz", "smooth", "sleek"))), (1, SHAMPOO)]),
    Case("big bottle of shampoo", text="family size shampoo",
         grades=[(3, all_of(SHAMPOO, words("family-size"))), (1, SHAMPOO)]),

    # --- coffee ------------------------------------------------------------------
    Case("dark roast", text="dark roast coffee",
         grades=[(3, all_of(COFFEE, DARK)), (1, COFFEE)]),
    Case("espresso", text="ground espresso",
         grades=[(3, all_of(COFFEE, words("espresso"))), (2, all_of(COFFEE, DARK)), (1, COFFEE)]),
    Case("decaf", text="decaf coffee",
         grades=[(3, all_of(COFFEE, words("decaf"))), (1, COFFEE)]),
    Case("flavored coffee", text="flavored coffee like vanilla or hazelnut",
         grades=[(3, all_of(COFFEE, words("vanilla", "hazelnut", "caramel", "pecan", "mocha", "flavored"))), (1, COFFEE)]),
    Case("light roast", text="light mild coffee",
         grades=[(3, all_of(COFFEE, words("light-roast", "blonde-roast"))), (2, all_of(COFFEE, words("medium-roast", "breakfast"))), (1, COFFEE)]),
    Case("morning coffee", text="coffee for my morning",
         grades=[(2, COFFEE)]),
    Case("strong coffee", text="strong bold coffee",
         grades=[(3, all_of(COFFEE, DARK)), (1, COFFEE)]),
    Case("cheap coffee", text="coffee under $8",
         grades=[(3, all_of(COFFEE, under(8))), (0, COFFEE)]),

    # --- should show nothing ------------------------------------------------------
    Case("car tires", text="car tires"),
    Case("lawn mower", text="lawn mower"),
    Case("dog food", text="dog food"),
    Case("phone charger", text="iphone charger"),
    Case("pizza", text="pizza"),
    Case("winter jacket", text="winter jacket"),
    Case("toothpaste", text="toothpaste"),
    Case("video game", text="video game"),
    Case("couch", text="a new couch for the living room"),

    # --- from a product (scan or search, then "more like this") -------------------
    Case("like a running shoe", product="Nike Pegasus 40",
         grades=[(3, ptype("Running Shoe")), (2, ptype("Trail Shoe", "Sneaker")), (1, SHOES)]),
    Case("like a rain boot", product="Hunter Original Tall Rain Boots",
         grades=[(3, ptype("Rain Boot", "Kids Rain Boot")), (2, all_of(SHOES, words("waterproof"))), (1, SHOES)]),
    Case("like a dress shoe", product="Allen Edmonds Park Avenue",
         grades=[(3, ptype("Dress Shoe", "Loafer")), (2, ptype("Moccasin", "Flat", "Boat Shoe")), (1, SHOES)]),
    Case("like noise cancelling headphones", product="Sony WH-1000XM4 Wireless Headphones",
         grades=[(3, all_of(HEADPHONES, NOISE_CANCELLING, OVER_EAR)), (2, all_of(HEADPHONES, OVER_EAR)), (1, HEADPHONES)]),
    Case("like AirPods", product="Apple AirPods (2nd Generation)",
         grades=[(3, all_of(HEADPHONES, EARBUDS, words("wireless"))), (2, all_of(HEADPHONES, EARBUDS)), (1, HEADPHONES)]),
    Case("like a laptop backpack", product="SwissGear 1271 ScanSmart Laptop Backpack",
         grades=[(3, all_of(BACKPACKS, LAPTOP)), (2, all_of(BACKPACKS, words("business", "work", "commut"))), (1, BACKPACKS)]),
    Case("like a dark roast", product="Starbucks Espresso Roast Ground Coffee, 18 oz",
         grades=[(3, all_of(COFFEE, DARK)), (1, COFFEE)]),
    Case("like a decaf", product="Maxwell House Original Blend Decaf Ground Coffee, 11 oz",
         grades=[(3, all_of(COFFEE, words("decaf"))), (1, COFFEE)]),
    Case("like a dandruff shampoo", product="Head & Shoulders Instant Oil Control Shampoo, 12.8 fl oz",
         grades=[(3, all_of(SHAMPOO, DANDRUFF)), (1, SHAMPOO)]),
    Case("like a moisturizing shampoo", product="Dove Daily Moisture Shampoo, 12 fl oz",
         grades=[(3, all_of(SHAMPOO, DRY_HAIR)), (1, SHAMPOO)]),

    # --- product plus text -----------------------------------------------------
    Case("rain boot but for kids", product="Hunter Original Tall Rain Boots", text="for my kid",
         grades=[(3, ptype("Kids Rain Boot")), (2, ptype("Rain Boot")), (1, SHOES)]),
    Case("headphones but earbuds", product="Sony WH-1000XM4 Wireless Headphones", text="earbuds instead",
         grades=[(3, all_of(HEADPHONES, EARBUDS, NOISE_CANCELLING)), (2, all_of(HEADPHONES, EARBUDS)), (1, HEADPHONES)]),
    Case("coffee but decaf", product="Starbucks Pike Place Ground Coffee, 12 oz", text="decaf",
         grades=[(3, all_of(COFFEE, words("decaf"))), (1, COFFEE)]),

    # --- ranked criteria --------------------------------------------------------
    Case("headphones, price first", text="headphones", ranks=PRICE_FIRST,
         grades=[(3, all_of(HEADPHONES, under(30))), (2, all_of(HEADPHONES, under(60))), (1, HEADPHONES)]),
    Case("running shoes, price first", text="running shoes", ranks=PRICE_FIRST,
         grades=[(3, all_of(ptype("Running Shoe"), under(130))), (2, ptype("Running Shoe")), (1, SHOES)]),
    Case("coffee, price first", text="ground coffee", ranks=PRICE_FIRST,
         grades=[(3, all_of(COFFEE, under(7))), (2, all_of(COFFEE, under(9))), (1, COFFEE)]),
]
