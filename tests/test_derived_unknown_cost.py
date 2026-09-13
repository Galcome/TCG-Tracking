"""An unknown inherited cost must not become free stock in downstream FIFO."""

import pytest


@pytest.mark.parametrize("kind", ["crack", "rip"])
def test_unknown_transformation_basis_stays_unknown_when_sold(client, make_product, kind):
    source = make_product("Unknown inherited source")
    child = make_product("Unknown inherited output")
    adjustment = client.post(
        "/api/v1/adjustments",
        json={
            "product_id": source["id"],
            "quantity_delta": 1,
            "reason": "opening_inventory",
        },
    )
    assert adjustment.status_code == 201, adjustment.text
    rows = [{"product_id": child["id"], "quantity": 1}]
    operation = client.post(
        f"/api/v1/transformations/{kind}",
        json={
            "product_id": source["id"],
            "outputs" if kind == "crack" else "hits": rows,
        },
    )
    assert operation.status_code == 201, operation.text
    assert operation.json()["outputs"][0]["cost"] is None
    preview = client.post(
        "/api/v1/sales/preview",
        json={
            "product_id": child["id"],
            "quantity": 1,
            "amount": "100.00",
        },
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["cost_basis"] is None
    assert preview.json()["realized_profit"] is None
    sale = client.post(
        "/api/v1/sales",
        json={
            "product_id": child["id"],
            "quantity": 1,
            "amount": "100.00",
            "proceeds": [],
        },
    )
    assert sale.status_code == 201, sale.text
    assert sale.json()["has_unknown_cost"] is True
    assert sale.json()["cost_basis"] is None
    assert sale.json()["realized_profit"] is None
