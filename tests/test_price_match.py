"""Suggesting the catalog listing for a product.

What matters: code only claims a match it can be certain of, anything less goes to a
model as a short list, a model that is down or unsure leaves the choice to the person, and
nothing here ever creates a mapping by itself.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from src.models.card_set import CardSet
from src.models.taxonomy import Game, ProductType
from src.routes import pricing as pricing_route
from src.services import ai, price_match
from src.services.pricing import CatalogProduct, PricingError

SURGING_SPARKS = 23651


def listing(product_id: int, name: str, number: str | None = None, clean: str | None = None):
    return CatalogProduct(
        product_id, 3, SURGING_SPARKS, name, clean, None, None, ("Normal",), number
    )


CATALOG = [
    listing(1, "Surging Sparks Booster Box"),
    listing(2, "Surging Sparks Booster Box Case"),
    listing(3, "Surging Sparks Booster Pack"),
    listing(4, "Surging Sparks Sleeved Booster Pack"),
    listing(5, "Surging Sparks Elite Trainer Box"),
    listing(6, "Pikachu ex", "057/191"),
    listing(7, "Pikachu ex", "238/191"),
    listing(8, "Pikachu ex - 247/191", "247/191", clean="Pikachu ex 247 191"),
    listing(9, "Pokémon Center Elite Trainer Box"),
]


class FakeProvider:
    def __init__(self, catalog=CATALOG, error: PricingError | None = None):
        self.catalog = catalog
        self.error = error
        self.calls: list[tuple[int, int]] = []

    def group_products(self, category_id: int, group_id: int):
        self.calls.append((category_id, group_id))
        if self.error:
            raise self.error
        return self.catalog


def product(
    name: str,
    *,
    type_name: str = "Booster Box",
    number: str | None = None,
    variant: str | None = None,
    group_id: int | None = SURGING_SPARKS,
    category_id: int | None = 3,
    has_set: bool = True,
):
    card_set = (
        SimpleNamespace(name="Surging Sparks", tcgcsv_group_id=group_id) if has_set else None
    )
    return SimpleNamespace(
        name=name,
        collector_number=number,
        variant=variant,
        card_set=card_set,
        game=SimpleNamespace(tcgcsv_category_id=category_id),
        product_type=SimpleNamespace(name=type_name),
    )


class Chooser:
    """Stands in for the model chain: records what it was asked, answers as told."""

    def __init__(self, monkeypatch, answer=None, error: Exception | None = None):
        self.answer = answer
        self.error = error
        self.asked: list[tuple[str, list[str]]] = []
        monkeypatch.setattr(ai, "choose", self)

    def __call__(self, subject, options):
        self.asked.append((subject, list(options)))
        if self.error:
            raise self.error
        return self.answer


def ids(suggestion) -> list[int]:
    return [item.product_id for item in suggestion.candidates]


# ------------------------------------------------------------------ certain


@pytest.mark.parametrize(
    "name", ["Booster Box", "Surging Sparks Booster Box", "surging sparks - booster box"]
)
def test_one_listing_by_name_is_certain_and_costs_no_model(monkeypatch, name):
    chooser = Chooser(monkeypatch)

    found = price_match.suggest(product(name), FakeProvider())

    assert (ids(found), found.suggested, found.method) == ([1], 0, "exact")
    assert chooser.asked == []


def test_a_numbered_card_is_certain_only_with_its_number(monkeypatch):
    Chooser(monkeypatch)

    found = price_match.suggest(
        product("Pikachu ex", type_name="Raw Single", number="238/191"), FakeProvider()
    )

    assert (ids(found), found.method) == ([7], "exact")


def test_the_number_matches_without_its_leading_zeros(monkeypatch):
    Chooser(monkeypatch)

    found = price_match.suggest(product("Pikachu ex", number="57"), FakeProvider())

    assert ids(found) == [6]


def test_the_clean_name_counts_as_the_name(monkeypatch):
    Chooser(monkeypatch)

    found = price_match.suggest(product("Pikachu ex 247 191"), FakeProvider())

    assert (ids(found), found.method) == ([8], "exact")


def test_accents_and_ampersands_do_not_break_a_match(monkeypatch):
    Chooser(monkeypatch)
    catalog = [listing(1, "Scarlet & Violet Pokémon Center ETB")]

    found = price_match.suggest(
        product("Scarlet and Violet Pokemon Center ETB"), FakeProvider(catalog)
    )

    assert found.method == "exact"


# ------------------------------------------------------------ not certain


def test_two_printings_of_one_name_go_to_the_model(monkeypatch):
    chooser = Chooser(monkeypatch, answer=1)

    found = price_match.suggest(
        product("Pikachu ex", type_name="Raw Single", variant="Special Illustration Rare"),
        FakeProvider(),
    )

    assert ids(found)[:2] == [6, 7]
    assert (found.suggested, found.method) == (1, "ai")
    subject, options = chooser.asked[0]
    assert subject == (
        "Raw Single - Pikachu ex (set: Surging Sparks, variant: Special Illustration Rare)"
    )
    assert options[:2] == ["Pikachu ex (number 057/191)", "Pikachu ex (number 238/191)"]


def test_a_loosely_named_product_gets_a_short_list_best_first(monkeypatch):
    chooser = Chooser(monkeypatch, answer=0)

    found = price_match.suggest(product("ETB", type_name="Box Set"), FakeProvider())

    assert found.candidates == []
    assert chooser.asked == []
    assert found.message == "No listing in Surging Sparks looks like this product."

    found = price_match.suggest(
        product("Elite Trainer Box", type_name="Box Set", number="5"), FakeProvider()
    )
    assert ids(found)[0] == 5
    assert found.method == "ai"
    assert "number: 5" in chooser.asked[-1][0]


def test_the_short_list_is_bounded(monkeypatch):
    Chooser(monkeypatch)
    catalog = [listing(n, f"Booster Bundle {n}") for n in range(1, 30)]

    found = price_match.suggest(product("Booster Bundle"), FakeProvider(catalog))

    assert len(found.candidates) == price_match.MAX_CANDIDATES


def test_an_unsure_model_leaves_the_choice_to_the_person(monkeypatch):
    Chooser(monkeypatch, answer=None)

    found = price_match.suggest(product("Booster"), FakeProvider())

    assert ids(found)
    assert (found.suggested, found.method) == (None, None)


def test_no_model_reachable_still_returns_the_short_list(monkeypatch):
    Chooser(monkeypatch, error=ai.AIUnavailable("down"))

    found = price_match.suggest(product("Booster"), FakeProvider())

    assert ids(found)
    assert found.suggested is None


# ------------------------------------------------------------ nothing to ask


@pytest.mark.parametrize(
    "unlinked",
    [{"has_set": False}, {"group_id": None}, {"category_id": None}],
)
def test_an_unlinked_product_asks_nobody(monkeypatch, unlinked):
    chooser = Chooser(monkeypatch)
    provider = FakeProvider()

    found = price_match.suggest(product("Booster Box", **unlinked), provider)

    assert found.candidates == []
    assert "not linked" in found.message
    assert provider.calls == chooser.asked == []


def test_a_catalog_failure_is_raised_for_the_route_to_report(monkeypatch):
    Chooser(monkeypatch)

    with pytest.raises(PricingError):
        price_match.suggest(product("Booster Box"), FakeProvider(error=PricingError("down")))


# ------------------------------------------------------------------ the route


@pytest.fixture
def linked_set(db, game_id) -> CardSet:
    card_set = CardSet(game_id=game_id, name="Surging Sparks Test", tcgcsv_group_id=987654)
    db.add(card_set)
    db.flush()
    return card_set


def test_the_route_prefills_without_creating_a_mapping(client, db, make_product, linked_set):
    item = make_product("Booster Box", set_name=linked_set.name)
    catalog = [listing(1, "Surging Sparks Test Booster Box", clean="Booster Box")]
    fake = FakeProvider(catalog)
    pricing_route.catalog_provider, original = fake, pricing_route.catalog_provider
    try:
        response = client.get("/api/v1/pricing/suggestion", params={"product_id": item["id"]})
    finally:
        pricing_route.catalog_provider = original

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["suggested_index"] == 0
    assert body["method"] == "exact"
    assert body["candidates"][0]["product_id"] == 1
    category = db.scalar(select(Game.tcgcsv_category_id).where(Game.id == linked_set.game_id))
    assert fake.calls == [(category, 987654)]
    assert client.get(
        "/api/v1/pricing/mappings", params={"product_id": item["id"]}
    ).json() == []


def test_the_route_reports_a_catalog_outage(client, make_product, linked_set):
    item = make_product("Booster Box", set_name=linked_set.name)
    pricing_route.catalog_provider, original = (
        FakeProvider(error=PricingError("feed down")),
        pricing_route.catalog_provider,
    )
    try:
        response = client.get("/api/v1/pricing/suggestion", params={"product_id": item["id"]})
    finally:
        pricing_route.catalog_provider = original

    assert response.status_code == 503
    assert "feed down" in response.json()["detail"]


def test_the_route_refuses_what_cannot_be_priced(client, db, make_product):
    lot_type = db.scalar(select(ProductType.id).where(ProductType.slug == "lot"))
    item = make_product("Mixed Lot", product_type_id=str(lot_type))

    response = client.get("/api/v1/pricing/suggestion", params={"product_id": item["id"]})

    assert response.status_code == 422


def test_the_route_404s_an_unknown_product(client):
    response = client.get(
        "/api/v1/pricing/suggestion",
        params={"product_id": "00000000-0000-0000-0000-000000000000"},
    )

    assert response.status_code == 404
