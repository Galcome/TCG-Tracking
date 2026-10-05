"""Tests for the games and product-types routes."""

import pytest

ROUTES = ["/api/v1/games", "/api/v1/product-types"]


@pytest.mark.parametrize("route", ROUTES)
def test_seeded_taxonomy_is_listed_in_sort_order(client, route: str):
    items = client.get(route).json()
    assert len(items) >= 10
    assert all(item["is_system"] for item in items)
    assert [item["sort_order"] for item in items] == sorted(item["sort_order"] for item in items)


def test_seeded_games_match_the_brief(client):
    slugs = [game["slug"] for game in client.get("/api/v1/games").json()]
    assert slugs[:4] == ["pokemon", "magic-the-gathering", "yu-gi-oh", "lorcana"]


def test_sealed_products_have_their_own_types_ahead_of_the_catch_alls(client):
    slugs = [kind["slug"] for kind in client.get("/api/v1/product-types").json()]
    for slug in (
        "elite-trainer-box",
        "pokemon-center-elite-trainer-box",
        "etb-case",
        "booster-bundle",
        "collector-booster-box",
        "premium-collection",
        "ultra-premium-collection",
        "super-premium-collection",
        "pin-collection",
        "poster-collection",
        "build-and-battle-box",
        "build-and-battle-stadium",
        "trainers-toolkit",
        "holiday-calendar",
        "mini-tin",
        "illumineers-trove",
        "tin",
        "blister",
        "gift-set",
        "prerelease-kit",
        "secret-lair",
    ):
        assert slug in slugs
    assert slugs.index("ultra-premium-collection") == slugs.index("premium-collection") + 1
    assert slugs.index("mini-tin") == slugs.index("tin") + 1
    assert slugs[-2:] == ["lot", "other"]


@pytest.mark.parametrize("route", ROUTES)
def test_members_can_add_their_own_values(client, route: str):
    response = client.post(route, json={"name": "Weiss Schwarz"})
    assert response.status_code == 201
    body = response.json()
    assert body["slug"] == "weiss-schwarz"
    assert body["is_system"] is False


@pytest.mark.parametrize("route", ROUTES)
def test_duplicate_values_are_rejected(client, route: str):
    client.post(route, json={"name": "Weiss Schwarz"})
    response = client.post(route, json={"name": "  weiss   schwarz  "})
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


@pytest.mark.parametrize("route", ROUTES)
def test_a_name_that_cannot_be_slugged_is_rejected(client, route: str):
    response = client.post(route, json={"name": "!!!"})
    assert response.status_code == 422
    assert "at least one letter or number" in response.json()["detail"]


@pytest.mark.parametrize("route", ROUTES)
def test_blank_names_are_rejected(client, route: str):
    assert client.post(route, json={"name": "   "}).status_code == 422
