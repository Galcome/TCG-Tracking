"""Authenticated mapping operations and their strict product boundary."""

import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from src.models.catalog import CatalogMapping
from src.models.market_price import CurrentMarketQuote
from src.models.taxonomy import ProductType
from src.routes import pricing as pricing_route
from src.services import pricing


def mapping_payload(product_id: str, **overrides) -> dict:
    return {
        "product_id": product_id,
        "provider": "tcgcsv",
        "external_product_id": "42",
        "external_group_id": "7",
        "external_category_id": "1",
        "subtype_name": "Normal",
        **overrides,
    }


def test_mapping_create_list_update_and_duplicate_guard(client, make_product):
    product = make_product("Mapped Box")
    created = client.post("/api/v1/pricing/mappings", json=mapping_payload(product["id"]))
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["product_id"] == product["id"]
    assert body["subtype_name"] == "Normal"

    duplicate = client.post("/api/v1/pricing/mappings", json=mapping_payload(product["id"]))
    assert duplicate.status_code == 409

    listed = client.get("/api/v1/pricing/mappings", params={"product_id": product["id"]})
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [body["id"]]
    assert client.get("/api/v1/pricing/mappings").json()[0]["id"] == body["id"]

    updated = client.patch(
        f"/api/v1/pricing/mappings/{body['id']}",
        json={"subtype_name": " Holofoil ", "match_status": "disabled"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["subtype_name"] == "Holofoil"
    assert updated.json()["match_status"] == "disabled"

    missing = client.patch(f"/api/v1/pricing/mappings/{uuid.uuid4()}", json={})
    assert missing.status_code == 404


@pytest.mark.parametrize(
    "changes",
    [
        {"external_product_id": "not-numeric"},
        {"external_group_id": "not-numeric"},
        {"external_category_id": "not-numeric"},
        {"external_group_id": None},
        {"subtype_name": None},
        {"match_status": None},
    ],
)
def test_mapping_update_rejects_invalid_final_tcgcsv_identity(client, make_product, changes):
    product = make_product("Invalid Mapping Update")
    created = client.post("/api/v1/pricing/mappings", json=mapping_payload(product["id"]))
    assert created.status_code == 201, created.text
    response = client.patch(
        f"/api/v1/pricing/mappings/{created.json()['id']}", json=changes
    )
    assert response.status_code == 422, response.text


def test_mapping_create_rejects_missing_and_non_numeric_tcgcsv_fields(client, make_product):
    product = make_product("Invalid Mapping Create")
    for changes in (
        {"external_group_id": None},
        {"external_category_id": None},
        {"subtype_name": "   "},
        {"external_product_id": "not-numeric"},
    ):
        response = client.post(
            "/api/v1/pricing/mappings", json=mapping_payload(product["id"], **changes)
        )
        assert response.status_code == 422, response.text

    missing_product = client.post(
        "/api/v1/pricing/mappings", json=mapping_payload(str(uuid.uuid4()))
    )
    assert missing_product.status_code == 404


def test_mapping_create_rejects_graded_and_unsupported_products(client, db, game_id):
    graded_type = db.scalar(select(ProductType.id).where(ProductType.slug == "graded-card"))
    pack_type = db.scalar(select(ProductType.id).where(ProductType.slug == "booster-pack"))
    assert graded_type and pack_type

    def create(name, product_type_id):
        response = client.post(
            "/api/v1/products",
            json={
                "name": name,
                "game_id": str(game_id),
                "product_type_id": str(product_type_id),
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    graded = create("Graded Slab", graded_type)
    response = client.post("/api/v1/pricing/mappings", json=mapping_payload(graded["id"]))
    assert response.status_code == 422
    assert "manual" in response.json()["detail"]

    unsupported = create("Loose Pack", pack_type)
    response = client.post(
        "/api/v1/pricing/mappings", json=mapping_payload(unsupported["id"])
    )
    assert response.status_code == 422
    assert "supports raw cards" in response.json()["detail"]


def test_pricing_refresh_is_authenticated_and_returns_service_summary(client, monkeypatch):
    expected = pricing.RefreshSummary(3, 2, 1, 0, 0, "2026-08-29", ("one warning",))
    monkeypatch.setattr(pricing_route.pricing_service, "refresh", lambda _db: expected)

    response = client.post("/api/v1/pricing/refresh")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "attempted": 3,
        "refreshed": 2,
        "skipped": 1,
        "stale": 0,
        "unavailable": 0,
        "source_revision": "2026-08-29",
        "errors": ["one warning"],
    }


def test_current_estimate_is_display_only_and_disabled_mappings_are_hidden(
    client, db, make_product
):
    product = make_product("Quoted Box")
    created = client.post("/api/v1/pricing/mappings", json=mapping_payload(product["id"]))
    assert created.status_code == 201, created.text
    mapping_row = db.get(CatalogMapping, uuid.UUID(created.json()["id"]))
    db.add(
        CurrentMarketQuote(
            mapping_id=mapping_row.id,
            product_id=mapping_row.product_id,
            status="stale",
            original_currency="USD",
            original_value_cents=1000,
            cad_value_cents=1350,
            source_revision="feed-1",
            source_as_of=date(2026, 8, 28),
        )
    )
    db.flush()

    detail = client.get(f"/api/v1/products/{product['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["market_estimate"] == {
        "value": "13.50",
        "captured_on": "2026-08-28",
        "status": "stale",
        "provider": "tcgcsv",
        "source_revision": "feed-1",
    }
    assert detail.json()["stats"]["remaining_cost"] == "0.00"

    client.patch(
        f"/api/v1/pricing/mappings/{mapping_row.id}", json={"match_status": "disabled"}
    )
    assert client.get(f"/api/v1/products/{product['id']}").json()["market_estimate"] is None


def test_vault_keeps_manual_valuation_separate_from_market_estimate(client, db, make_product):
    product = make_product("Vault Quote")
    purchase = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "100.00",
            "bucket": "vault",
        },
    )
    assert purchase.status_code == 201, purchase.text
    created = client.post("/api/v1/pricing/mappings", json=mapping_payload(product["id"]))
    assert created.status_code == 201, created.text
    mapping_row = db.get(CatalogMapping, uuid.UUID(created.json()["id"]))
    db.add(
        CurrentMarketQuote(
            mapping_id=mapping_row.id,
            product_id=mapping_row.product_id,
            status="fresh",
            original_currency="USD",
            original_value_cents=1000,
            cad_value_cents=1350,
            source_revision="feed-1",
            source_as_of=date(2026, 8, 28),
        )
    )
    db.flush()

    rows = client.get("/api/v1/reports/vault")
    assert rows.status_code == 200, rows.text
    row = rows.json()[0]
    assert row["value"] is None
    assert row["market_estimate"]["value"] == "13.50"
    assert row["market_estimate"]["status"] == "fresh"


def test_mapping_validation_unit_rejects_unknown_provider_and_product():
    product = SimpleNamespace(product_type=SimpleNamespace(slug="booster-box"))
    with pytest.raises(Exception):
        pricing_route._validate_mapping(
            {"provider": "unknown", "match_status": "confirmed"}, product
        )


def test_mapping_create_turns_a_racing_unique_conflict_into_409():
    product = SimpleNamespace(id=uuid.uuid4(), product_type=SimpleNamespace(slug="booster-box"))
    payload = pricing_route.CatalogMappingCreate(
        product_id=product.id,
        external_product_id="42",
        external_group_id="7",
        external_category_id="1",
        subtype_name="Normal",
    )
    member = SimpleNamespace(id=uuid.uuid4())

    class Db:
        def get(self, _model, _record_id):
            return product

        def scalar(self, _statement):
            return None

        def add(self, _item):
            return None

        def flush(self):
            raise IntegrityError("duplicate", None, Exception("duplicate"))

    with pytest.raises(pricing_route.HTTPException) as exc:
        pricing_route.create_mapping(payload, member, Db())
    assert exc.value.status_code == 409


def test_pricing_routes_require_authentication():
    from src.main import app

    response = TestClient(app).get("/api/v1/pricing/mappings")
    assert response.status_code in (401, 403)
