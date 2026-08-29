"""Conservative product candidate suggestions for rip/photo entry."""

from types import SimpleNamespace

from sqlalchemy import select

from src.models.product import Product
from src.models.taxonomy import ProductType
from src.services.product_matching import (
    ProductIdentity,
    _score,
    find_candidates,
    normalize_identity,
)


def test_normalize_identity_folds_common_camera_and_typing_differences():
    assert normalize_identity("Pikachu EX") == normalize_identity("  pikachu-ex ")
    assert normalize_identity("123 / 204") == normalize_identity("123/204")
    assert normalize_identity("Éclair") == normalize_identity("éclair")


def test_score_rejects_wrong_game_or_name_and_blank_search_short_circuits():
    product = SimpleNamespace(game_id="pokemon", name="Pikachu EX")
    assert _score(product, ProductIdentity(game_id="magic", name="Pikachu EX")) is None
    assert _score(product, ProductIdentity(game_id="pokemon", name="Charizard")) is None
    assert find_candidates(None, ProductIdentity(game_id="pokemon", name="   ")) == []


def test_candidates_require_game_name_and_supplied_identity_fields(
    client, db, make_product, game_id
):
    single_type_id = db.scalar(select(ProductType.id).where(ProductType.slug == "single"))
    exact = make_product(
        "Pikachu-ex",
        product_type_id=str(single_type_id),
        set_name="Fabled",
        collector_number="123/204",
        variant="Holofoil",
        language="English",
    )
    other_set = make_product(
        "Pikachu-ex",
        product_type_id=str(single_type_id),
        set_name="Other Set",
        collector_number="123/204",
        variant="Holofoil",
        language="English",
    )
    archived = make_product(
        "Pikachu-ex",
        product_type_id=str(single_type_id),
        set_name="Fabled",
        collector_number="123/204",
        variant="Holofoil",
        language="English",
    )
    archive = client.patch(f"/api/v1/products/{archived['id']}", json={"is_archived": True})
    assert archive.status_code == 200, archive.text

    response = client.get(
        "/api/v1/products/candidates",
        params={
            "game_id": str(game_id),
            "name": "Pikachu EX",
            "set_name": "fabled",
            "collector_number": "123 / 204",
            "variant": "holofoil",
            "language": "english",
        },
    )
    assert response.status_code == 200, response.text
    rows = response.json()
    assert [row["id"] for row in rows] == [exact["id"]]
    assert rows[0]["matched_fields"] == [
        "game",
        "name",
        "set_name",
        "collector_number",
        "variant",
        "language",
    ]
    assert rows[0]["match_score"] == 200
    assert rows[0]["quantity_on_hand"] == 0

    assert other_set["id"] not in [row["id"] for row in rows]


def test_candidates_allow_same_name_when_optional_identity_is_blank(
    client, db, make_product, game_id
):
    single_type_id = db.scalar(select(ProductType.id).where(ProductType.slug == "single"))
    first = make_product(
        "Same Name", set_name="First Set", product_type_id=str(single_type_id)
    )
    second = make_product(
        "Same Name", set_name="Second Set", product_type_id=str(single_type_id)
    )
    response = client.get(
        "/api/v1/products/candidates",
        params={"game_id": str(game_id), "name": "same name"},
    )
    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()} == {first["id"], second["id"]}
    assert all(row["match_score"] == 100 for row in response.json())


def test_candidate_search_is_bounded_and_never_writes(client, db, make_product, game_id):
    single_type_id = db.scalar(select(ProductType.id).where(ProductType.slug == "single"))
    product = make_product("Bounded Name", product_type_id=str(single_type_id))
    before = db.scalar(select(Product).where(Product.id == product["id"]))
    matches = find_candidates(
        db,
        ProductIdentity(game_id=game_id, name="Bounded Name"),
    )
    after = db.scalar(select(Product).where(Product.id == product["id"]))
    assert [match.product.id for match in matches] == [before.id]
    assert after.updated_at == before.updated_at


def test_candidates_exclude_non_hit_product_types(client, make_product, game_id):
    booster_box = make_product("Shared Name")
    response = client.get(
        "/api/v1/products/candidates",
        params={"game_id": str(game_id), "name": "Shared Name"},
    )
    assert response.status_code == 200, response.text
    assert booster_box["id"] not in {row["id"] for row in response.json()}
