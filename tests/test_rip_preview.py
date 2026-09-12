"""Rip draft previews use authoritative FIFO without creating accounting rows."""

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from src.auth import get_current_user
from src.main import app
from src.models.audit import AuditLog
from src.models.ledger import CostAllocation, InventoryAdjustment, Purchase, Sale
from src.models.member import Member
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product
from src.models.taxonomy import ProductType
from src.models.transformation import Transformation, TransformationOutput
from tests.test_rip import buy

PATH = "/api/v1/transformations/rip/preview"


def preview(client, product_id, **extra):
    return client.post(PATH, json={"product_id": product_id, **extra})


def counts(db):
    return tuple(
        db.scalar(select(func.count()).select_from(model))
        for model in (
            Product,
            Purchase,
            Sale,
            InventoryAdjustment,
            Transformation,
            TransformationOutput,
            PriceSnapshot,
            AuditLog,
            CostAllocation,
        )
    )


def test_preview_uses_fifo_and_writes_nothing_for_unsaved_hits(client, make_product, db):
    box = make_product("Preview mixed lot box")
    buy(client, box["id"], 1, "10.01", date.today() - timedelta(days=2))
    buy(client, box["id"], 1, "100.00", date.today() - timedelta(days=1))
    before = counts(db)
    response = preview(
        client,
        box["id"],
        hits=[
            {"key": "unsaved-a", "quantity": 2, "value": "1.00"},
            {"key": "unsaved-b", "value": "2.00"},
        ],
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "source_cost": "10.01",
        "has_unknown_cost": False,
        "quantity_available": 2,
        "hits": [
            {"key": "unsaved-a", "quantity": 2, "cost": "5.01"},
            {"key": "unsaved-b", "quantity": 1, "cost": "5.00"},
        ],
        "bulk_cost": "0.00",
        "nonbinding": True,
    }
    assert counts(db) == before


def test_preview_changes_after_sale_and_matches_saved_fifo(client, make_product):
    box, hit = make_product("Preview sale box"), make_product("Preview saved hit")
    buy(client, box["id"], 1, "10.00", date.today() - timedelta(days=2))
    buy(client, box["id"], 1, "100.00", date.today() - timedelta(days=1))
    assert preview(client, box["id"], hits=[{"key": "a"}]).json()["source_cost"] == "10.00"
    sale = client.post(
        "/api/v1/sales",
        json={"product_id": box["id"], "quantity": 1, "amount": "20.00", "proceeds": []},
    )
    assert sale.status_code == 201, sale.text
    current = preview(client, box["id"], hits=[{"key": "a"}]).json()
    assert current["source_cost"] == "100.00"
    saved = client.post(
        "/api/v1/transformations/rip",
        json={"product_id": box["id"], "hits": [{"product_id": hit["id"]}]},
    )
    assert saved.status_code == 201, saved.text
    assert saved.json()["outputs"][0]["cost"] == current["hits"][0]["cost"]


def test_preview_unknown_backdated_and_known_zero_are_distinct(client, make_product):
    box = make_product("Preview dated zero")
    buy(client, box["id"], 1, "0.00")
    unknown = preview(
        client,
        box["id"],
        occurred_on=(date.today() - timedelta(days=1)).isoformat(),
        hits=[{"key": "a", "value": "100.00", "cost": "20.00"}],
    )
    assert unknown.status_code == 200, unknown.text
    assert unknown.json()["has_unknown_cost"] is True
    assert unknown.json()["source_cost"] is None
    assert unknown.json()["hits"][0]["cost"] is None
    assert unknown.json()["bulk_cost"] is None
    zero = preview(client, box["id"]).json()
    assert zero["source_cost"] == "0.00"
    assert zero["bulk_cost"] == "0.00"


def test_preview_same_day_consumers_and_voided_history_follow_fifo(client, make_product):
    box = make_product("Preview same-day pennies")
    buy(client, box["id"], 2, "10.01")
    sale = client.post(
        "/api/v1/sales",
        json={
            "product_id": box["id"],
            "quantity": 1,
            "amount": "0.00",
            "proceeds": [],
        },
    )
    assert sale.status_code == 201, sale.text
    assert preview(client, box["id"]).json()["source_cost"] == "5.00"
    void = client.post(f"/api/v1/sales/{sale.json()['id']}/void", json={"reason": "Undo test"})
    assert void.status_code == 200, void.text
    assert preview(client, box["id"]).json()["source_cost"] == "5.01"


def test_preview_empty_and_explicit_zero_preserve_bulk(client, make_product):
    box = make_product("Preview bulk")
    buy(client, box["id"], 1, "10.01")
    assert preview(client, box["id"]).json()["bulk_cost"] == "10.01"
    explicit = preview(client, box["id"], hits=[{"key": "a", "cost": "0.00"}]).json()
    assert explicit["hits"][0]["cost"] == "0.00"
    assert explicit["bulk_cost"] == "10.01"
    over = preview(client, box["id"], hits=[{"key": "a", "cost": "10.02"}])
    assert over.status_code in (409, 422), over.text


def test_preview_source_and_bucket_guards(client, make_product, db):
    assert preview(client, str(uuid.uuid4())).status_code == 404
    single = db.scalar(select(ProductType.id).where(ProductType.slug == "single"))
    card = make_product("Cannot preview opening card", product_type_id=str(single))
    assert preview(client, card["id"]).status_code == 422
    box = make_product("Empty preview source")
    assert preview(client, box["id"]).status_code == 409
    buy(client, box["id"], 1, "10.00")
    assert preview(client, box["id"], from_bucket="vault").status_code == 409


def test_preview_requires_auth_and_active_membership(client, make_product, db, claims):
    box = make_product("Protected preview")
    override = app.dependency_overrides.pop(get_current_user)
    try:
        assert preview(client, box["id"]).status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = override
    member = db.scalar(select(Member).where(Member.auth_user_id == claims["sub"]))
    member.is_active = False
    db.flush()
    assert preview(client, box["id"]).status_code == 403


@pytest.mark.parametrize(
    "extra",
    [
        {"hits": [{"key": ""}]},
        {"hits": [{"key": " "}]},
        {"hits": [{"key": "x"}, {"key": "x"}]},
        {"hits": [{"key": "x", "quantity": 0}]},
        {"hits": [{"key": "x", "value": "1.001"}]},
        {"hits": [{"key": "x", "cost": "-1.00"}]},
        {"quantity": 0},
        {"occurred_on": "2026-02-30"},
        {"from_bucket": "other"},
    ],
)
def test_preview_rejects_invalid_drafts(client, make_product, extra):
    box = make_product("Invalid preview source")
    assert preview(client, box["id"], **extra).status_code == 422
