import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from src.models.transformation import TRANSFORM_CRACK, Transformation
from src.services import transformations


def test_shared_writer_refuses_insufficient_stock_before_creating_rows(client, make_product, db):
    source = make_product("Shared writer stock guard")
    child = make_product("Shared writer output")
    bought = client.post(
        "/api/v1/purchases",
        json={
            "product_id": source["id"],
            "quantity": 1,
            "amount": "10.01",
        },
    )
    assert bought.status_code == 201
    source_id = uuid.UUID(source["id"])
    with pytest.raises(HTTPException) as rejected:
        transformations.transform(
            db,
            kind=TRANSFORM_CRACK,
            source_product_id=source_id,
            source_quantity=2,
            source_bucket="inventory",
            outputs=[
                transformations.OutputSpec(
                    product_id=uuid.UUID(child["id"]),
                    quantity=2,
                    bucket="inventory",
                )
            ],
            occurred_on=date.today(),
            member_id=None,
        )
    assert rejected.value.status_code == 409
    assert (
        db.scalar(select(Transformation.id).where(Transformation.source_product_id == source_id))
        is None
    )
    assert (
        client.get(f"/api/v1/products/{source['id']}").json()["stats"]["remaining_cost"] == "10.01"
    )
    assert client.get(f"/api/v1/products/{child['id']}").json()["stats"]["quantity_on_hand"] == 0
