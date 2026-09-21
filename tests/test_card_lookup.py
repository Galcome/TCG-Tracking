"""Pricing a card from what the camera read, before it is a product.

What matters: the set and the listing are claimed by code only when certain and otherwise
go to a model as a short list; the price is always the catalog's, in CAD like the nightly
refresh; and a failure anywhere leaves a row the person can finish by hand.
"""

import json
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from src.models.card_set import CardSet
from src.models.taxonomy import Game
from src.routes import pricing as pricing_route
from src.services import ai, card_lookup
from src.services import pricing as pricing_service
from src.services.pricing import CatalogGroup, CatalogProduct, ExchangeRate, PricingError

CATEGORY = 3
SPARKS, PRISMATIC = 900001, 900002
TODAY = date(2026, 9, 19)


def listing(product_id, name, number=None, subtypes=("Normal", "Holofoil")):
    return CatalogProduct(
        product_id, CATEGORY, SPARKS, name, None, None, None, tuple(subtypes), number
    )


CATALOG = [
    listing(1, "Pikachu ex", "057/191"),
    listing(2, "Pikachu ex", "238/191", subtypes=("Holofoil",)),
    listing(3, "Raichu", "058/191"),
]

PRICES = {
    (1, "normal"): Decimal("2.00"),
    (1, "holofoil"): Decimal("10.00"),
    (2, "holofoil"): Decimal("150.00"),
}


class FakeProvider:
    def __init__(self, catalog=CATALOG, prices=PRICES, error=None):
        self.catalog, self.prices, self.error = catalog, prices, error
        self.asked_groups: list[int] = []

    def groups(self, category_id):
        return [
            CatalogGroup(SPARKS, category_id, "SV08: Surging Sparks", "SSP", None),
            CatalogGroup(PRISMATIC, category_id, "SV: Prismatic Evolutions", "PRE", None),
            CatalogGroup(123, category_id, "Unlinked Set", "UNL", None),
        ]

    def group_products(self, category_id, group_id):
        if self.error:
            raise self.error
        self.asked_groups.append(group_id)
        return self.catalog

    def market_prices(self, category_id, group_id):
        return self.prices


class FakeFx:
    def __init__(self, rate="1.25", error=None):
        self.rate, self.error, self.calls = Decimal(rate), error, 0

    def usd_cad(self, on_or_before):
        self.calls += 1
        if self.error:
            raise self.error
        return ExchangeRate(self.rate, on_or_before)


class Chooser:
    def __init__(self, monkeypatch, *answers, error=None):
        self.answers, self.error = list(answers), error
        self.asked: list[tuple[str, list[str]]] = []
        monkeypatch.setattr(ai, "choose", self)

    def __call__(self, subject, options):
        self.asked.append((subject, list(options)))
        if self.error:
            raise self.error
        return self.answers.pop(0) if self.answers else None


@pytest.fixture(autouse=True)
def _fresh_rate():
    card_lookup.daily_rate._rate = None
    yield
    card_lookup.daily_rate._rate = None


@pytest.fixture
def game(db, game_id) -> Game:
    game = db.get(Game, game_id)
    game.tcgcsv_category_id = CATEGORY
    # Only these sets are linked, whatever the seeded calendar holds.
    for card_set in db.scalars(select(CardSet).where(CardSet.game_id == game_id)):
        card_set.tcgcsv_group_id = None
    db.flush()
    for name, group_id in [
        ("Surging Sparks", SPARKS),
        ("Prismatic Evolutions", PRISMATIC),
        ("Sparks Unlinked", None),
    ]:
        card_set = db.scalar(
            select(CardSet).where(CardSet.game_id == game_id, CardSet.name == name)
        ) or CardSet(game_id=game_id, name=name)
        card_set.tcgcsv_group_id = group_id
        db.add(card_set)
    db.flush()
    return game


def run(db, game, *, name="Pikachu ex", set_name="Surging Sparks", number=None,
        variant=None, provider=None, fx=None):
    return card_lookup.lookup(
        db,
        game,
        name=name,
        set_name=set_name,
        number=number,
        variant=variant,
        provider=provider or FakeProvider(),
        fx=fx or FakeFx(),
        today=TODAY,
    )


# ------------------------------------------------------------------- the printing


@pytest.mark.parametrize(
    ("subtypes", "variant", "expected"),
    [
        (("Normal", "Holofoil"), "Holofoil", "Holofoil"),
        (("Normal", "Holofoil"), "holo", "Holofoil"),
        (("Normal", "Reverse Holofoil"), "Reverse Holo", "Reverse Holofoil"),
        (("Holofoil", "Normal"), "Full Art", "Normal"),
        (("Holofoil",), None, "Holofoil"),
        ((), "Foil", "Normal"),
    ],
)
def test_the_printing_follows_the_read_variant(subtypes, variant, expected):
    assert card_lookup.preferred_subtype(subtypes, variant) == expected


def test_the_exchange_rate_is_fetched_once_a_day():
    fx = FakeFx()

    card_lookup.daily_rate.get(fx, TODAY)
    card_lookup.daily_rate.get(fx, TODAY)
    assert fx.calls == 1
    card_lookup.daily_rate.get(fx, date(2026, 9, 20))
    assert fx.calls == 2


# ---------------------------------------------------------------------- certain


def test_a_named_set_and_numbered_card_are_priced_in_cad(db, game, monkeypatch):
    chooser = Chooser(monkeypatch)

    found = run(db, game, number="238/191")

    assert found.set_name == "Surging Sparks"
    assert (found.suggested, found.method, found.message) == (0, "exact", None)
    [only] = found.candidates
    assert (only.listing.product_id, only.subtype, only.market_cents) == (2, "Holofoil", 18750)
    assert chooser.asked == []


def test_the_printed_set_code_is_as_good_as_the_name(db, game, monkeypatch):
    Chooser(monkeypatch)

    found = run(db, game, set_name="ssp", number="57", variant="holo")

    assert found.set_name == "Surging Sparks"
    assert found.candidates[0].market_cents == 1250


# ------------------------------------------------------------------ not certain


def test_an_unclear_set_goes_to_the_model_as_a_short_list(db, game, monkeypatch):
    chooser = Chooser(monkeypatch, 0, 1)

    found = run(db, game, set_name="Sparks")

    subject, options = chooser.asked[0]
    assert subject.endswith("set, as read off a card: Sparks")
    assert options == ["Surging Sparks"]
    assert found.set_name == "Surging Sparks"
    # Two printings of the one name: the model picks, the person still confirms.
    assert (found.suggested, found.method) == (1, "ai")
    assert [row.market_cents for row in found.candidates[:2]] == [250, 18750]


@pytest.mark.parametrize("answer", [None, ai.AIUnavailable("down")])
def test_a_set_nobody_can_place_leaves_it_to_the_person(db, game, monkeypatch, answer):
    if isinstance(answer, Exception):
        Chooser(monkeypatch, error=answer)
    else:
        Chooser(monkeypatch, answer)

    found = run(db, game, set_name="Sparks")

    assert found.candidates == []
    assert "Could not tell which set" in found.message


def test_a_set_like_nothing_linked_asks_nobody(db, game, monkeypatch):
    chooser = Chooser(monkeypatch)

    found = run(db, game, set_name="Base Set")

    assert "Base Set" in found.message
    assert chooser.asked == []


def test_a_listing_not_in_the_set_says_so(db, game, monkeypatch):
    Chooser(monkeypatch)

    found = run(db, game, name="Charizard")

    assert found.set_name == "Surging Sparks"
    assert found.candidates == []
    assert "No listing in Surging Sparks" in found.message


# ---------------------------------------------------------------- degrading


def test_a_printing_with_no_market_price_is_blank_not_zero(db, game, monkeypatch):
    Chooser(monkeypatch)

    found = run(db, game, number="57", provider=FakeProvider(prices={}))

    assert found.candidates[0].market_cents is None


def test_no_exchange_rate_still_names_the_card(db, game, monkeypatch):
    Chooser(monkeypatch)

    found = run(db, game, number="238", fx=FakeFx(error=PricingError("boc down")))

    assert found.candidates[0].listing.product_id == 2
    assert found.candidates[0].market_cents is None
    assert "Exchange rate" in found.message


def test_an_unreadable_set_or_uncatalogued_game_asks_nobody(db, game, game_id):
    assert "not readable" in run(db, game, set_name="  ").message

    game.tcgcsv_category_id = None
    assert "not in the price catalog" in run(db, game).message


def test_a_game_with_no_linked_sets_cannot_place_one(db, game, monkeypatch):
    Chooser(monkeypatch)
    for card_set in db.scalars(select(CardSet).where(CardSet.game_id == game.id)):
        card_set.tcgcsv_group_id = None
    db.flush()

    assert "Could not tell" in run(db, game).message


# ------------------------------------------------------------ provider prices


def test_group_market_prices_are_parsed_and_cached():
    calls = []
    body = json.dumps(
        {
            "success": True,
            "results": [
                {"productId": 1, "subTypeName": "Holofoil", "marketPrice": 3.5},
                {"productId": 1, "marketPrice": "2"},
                {"productId": 2, "subTypeName": "Normal", "marketPrice": None},
                {"productId": 3, "subTypeName": "Normal", "marketPrice": "-4"},
                {"subTypeName": "Normal", "marketPrice": "1"},
            ],
        }
    ).encode()

    def get_bytes(url, **_kwargs):
        calls.append(url)
        return body

    provider = pricing_service.TCGCSVProvider(get_bytes, pause=lambda _: None)

    prices = provider.market_prices(3, 7)
    assert prices == {(1, "holofoil"): Decimal("3.5"), (1, "normal"): Decimal("2")}
    assert provider.market_prices(3, 7) == prices
    assert calls == [f"{pricing_service.TCGCSV_BASE_URL}/tcgplayer/3/7/prices"]


# ---------------------------------------------------------------------- the route


@pytest.fixture
def providers(monkeypatch):
    fake = FakeProvider()
    monkeypatch.setattr(pricing_route, "catalog_provider", fake)
    monkeypatch.setattr(pricing_route, "fx_provider", FakeFx())
    return fake


def test_the_route_prices_a_read_card(client, game, providers, monkeypatch):
    Chooser(monkeypatch)

    response = client.post(
        "/api/v1/pricing/lookup",
        json={
            "game_id": str(game.id),
            "name": " Pikachu ex ",
            "set_name": "Surging Sparks",
            "collector_number": "238/191",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["set_name"] == "Surging Sparks"
    assert body["method"] == "exact"
    assert body["candidates"][0]["market"] == "187.50"
    assert body["candidates"][0]["listing"]["number"] == "238/191"


def test_the_route_describes_sealed_product_by_its_type(client, game, providers, monkeypatch):
    chooser = Chooser(monkeypatch)

    response = client.post(
        "/api/v1/pricing/lookup",
        json={
            "game_id": str(game.id),
            "name": "Pikachu",
            "set_name": "Surging Sparks",
            "kind": "Box Set",
        },
    )

    assert response.status_code == 200, response.text
    assert chooser.asked[-1][0].startswith("Box Set - Pikachu")


def test_the_route_reports_a_catalog_outage(client, game, providers, monkeypatch):
    Chooser(monkeypatch)
    providers.error = PricingError("feed down")

    response = client.post(
        "/api/v1/pricing/lookup",
        json={"game_id": str(game.id), "name": "Pikachu ex", "set_name": "Surging Sparks"},
    )

    assert response.status_code == 503


def test_the_route_404s_an_unknown_game(client, providers):
    response = client.post(
        "/api/v1/pricing/lookup",
        json={"game_id": "00000000-0000-0000-0000-000000000000", "name": "Pikachu"},
    )

    assert response.status_code == 404


def test_the_route_needs_a_name(client, game, providers):
    response = client.post(
        "/api/v1/pricing/lookup", json={"game_id": str(game.id), "name": ""}
    )

    assert response.status_code == 422
