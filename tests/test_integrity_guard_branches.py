import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.ledger import STATUS_VOIDED, InventoryAdjustment, Purchase
from src.models.transformation import (
    TRANSFORM_CRACK,
    TRANSFORM_RIP,
    Transformation,
    TransformationOutput,
)
from src.services import ledger, transformations


def _force_inactive_refresh(monkeypatch, db: Session, model: type) -> None:
    """Make the route's post-lock refresh observe a concurrent void."""
    real_refresh = Session.refresh

    def refresh(session, instance, *args, **kwargs):
        if session is db and isinstance(instance, model):
            instance.status = STATUS_VOIDED
            return None
        return real_refresh(session, instance, *args, **kwargs)

    monkeypatch.setattr(Session, "refresh", refresh)


def test_purchase_update_rejects_a_row_that_refreshes_inactive(
    client, db, make_product, monkeypatch
):
    product = make_product("Stale purchase guard")
    purchase = client.post(
        "/api/v1/purchases",
        json={"product_id": product["id"], "quantity": 1, "amount": "10.00"},
    ).json()
    _force_inactive_refresh(monkeypatch, db, Purchase)

    response = client.patch(
        f"/api/v1/purchases/{purchase['id']}", json={"notes": "stale edit"}
    )

    assert response.status_code == 409
    assert "voided" in response.json()["detail"]


def test_adjustment_update_rejects_a_row_that_refreshes_inactive(
    client, db, make_product, monkeypatch
):
    product = make_product("Stale adjustment guard")
    adjustment = client.post(
        "/api/v1/adjustments",
        json={
            "product_id": product["id"],
            "quantity_delta": 1,
            "reason": "opening_inventory",
        },
    ).json()
    _force_inactive_refresh(monkeypatch, db, InventoryAdjustment)

    response = client.patch(
        f"/api/v1/adjustments/{adjustment['id']}",
        json={"reason": "correction"},
    )

    assert response.status_code == 409
    assert "voided" in response.json()["detail"]


def test_generic_void_returns_404_for_an_unpersisted_purchase(db, make_product):
    product = make_product("Missing void target")
    missing = Purchase(
        id=uuid.uuid4(),
        product_id=uuid.UUID(product["id"]),
        quantity=1,
        gross_amount_cents=1000,
    )

    with pytest.raises(HTTPException) as rejected:
        ledger.void(
            db,
            missing,
            entity_type="purchase",
            member_id=None,
            reason="not actually saved",
        )

    assert rejected.value.status_code == 404


def test_generic_void_returns_409_after_refreshing_an_inactive_purchase(db, make_product):
    product = make_product("Already voided target")
    already_voided = Purchase(
        id=uuid.uuid4(),
        product_id=uuid.UUID(product["id"]),
        quantity=1,
        gross_amount_cents=1000,
        status=STATUS_VOIDED,
    )
    db.add(already_voided)
    db.flush()

    with pytest.raises(HTTPException) as rejected:
        ledger.void(
            db,
            already_voided,
            entity_type="purchase",
            member_id=None,
            reason="second void",
        )

    assert rejected.value.status_code == 409


@pytest.mark.parametrize(
    ("kwargs", "outputs", "message"),
    [
        (
            {"costs": [], "rip_policy": []},
            [],
            "either resolved costs or a rip policy",
        ),
        (
            {"costs": []},
            [transformations.OutputSpec(uuid.uuid4(), 1, "inventory")],
            "resolved costs must match",
        ),
        (
            {"rip_policy": []},
            [transformations.OutputSpec(uuid.uuid4(), 1, "inventory")],
            "rip policy must match",
        ),
    ],
)
def test_transform_rejects_conflicting_or_mismatched_cost_contracts(
    db, kwargs, outputs, message
):
    with pytest.raises(ValueError, match=message):
        transformations.transform(
            db,
            kind=TRANSFORM_RIP,
            source_product_id=uuid.uuid4(),
            source_quantity=1,
            source_bucket="inventory",
            outputs=outputs,
            occurred_on=date.today(),
            member_id=None,
            **kwargs,
        )


def test_transform_legacy_explicit_costs_preserve_bulk_remainder(client, db, make_product):
    source = make_product("Legacy cost source")
    child = make_product("Legacy cost child")
    purchase = client.post(
        "/api/v1/purchases",
        json={"product_id": source["id"], "quantity": 1, "amount": "10.00"},
    )
    assert purchase.status_code == 201

    record = transformations.transform(
        db,
        kind=TRANSFORM_CRACK,
        source_product_id=uuid.UUID(source["id"]),
        source_quantity=1,
        source_bucket="inventory",
        outputs=[
            transformations.OutputSpec(
                product_id=uuid.UUID(child["id"]), quantity=1, bucket="inventory"
            )
        ],
        costs=[600],
        occurred_on=date.today(),
        member_id=None,
    )
    db.flush()

    output = db.scalar(
        select(TransformationOutput).where(
            TransformationOutput.transformation_id == record.id
        )
    )
    assert record.bulk_cost_cents == 400
    assert output is not None
    assert output.cost_cents == 600


def test_rip_overbudget_returns_422_and_rolls_back_ledger_rows(client, db, make_product):
    source = make_product("Overbudget rip source")
    hit = make_product("Overbudget rip hit")
    purchase = client.post(
        "/api/v1/purchases",
        json={"product_id": source["id"], "quantity": 1, "amount": "10.00"},
    )
    assert purchase.status_code == 201
    db.commit()

    response = client.post(
        "/api/v1/transformations/rip",
        json={
            "product_id": source["id"],
            "quantity": 1,
            "hits": [
                {
                    "product_id": hit["id"],
                    "quantity": 1,
                    "value": "1.00",
                    "cost": "10.01",
                }
            ],
        },
    )

    assert response.status_code == 422
    assert "exceed" in response.json()["detail"]
    db.rollback()
    source_id = uuid.UUID(source["id"])
    hit_id = uuid.UUID(hit["id"])
    assert (
        db.scalar(select(Transformation.id).where(Transformation.source_product_id == source_id))
        is None
    )
    assert (
        db.scalar(
            select(InventoryAdjustment.id).where(
                InventoryAdjustment.product_id == source_id,
                InventoryAdjustment.reason == "transformed",
            )
        )
        is None
    )
    assert (
        db.scalar(
            select(Purchase.id).where(
                Purchase.product_id == hit_id,
                Purchase.is_derived.is_(True),
            )
        )
        is None
    )
