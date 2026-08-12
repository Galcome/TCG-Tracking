"""Stock buckets and moves.

Buckets are intent - inventory, store, vault - and deliberately orthogonal to cost. The
invariant worth guarding hardest is that moving stock never changes how much there is, and
never changes what it cost.
"""

from datetime import date, timedelta

import pytest

from src.models.ledger import BUCKET_INVENTORY, BUCKET_STORE, BUCKET_VAULT

TODAY = date.today()


def buy(client, product_id, quantity, amount, bucket=BUCKET_INVENTORY, on=None):
    response = client.post(
        "/api/v1/purchases",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "amount": amount,
            "bucket": bucket,
            "purchase_date": (on or TODAY).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def move(client, product_id, quantity, source, destination, **extra):
    return client.post(
        "/api/v1/moves",
        json={
            "product_id": product_id,
            "quantity": quantity,
            "from_bucket": source,
            "to_bucket": destination,
            **extra,
        },
    )


def buckets(client, product_id) -> dict[str, int]:
    return client.get(f"/api/v1/products/{product_id}").json()["stats"]["by_bucket"]


def test_stock_lands_in_inventory_unless_told_otherwise(client, make_product):
    product = make_product()
    buy(client, product["id"], 3, "300.00")

    assert buckets(client, product["id"]) == {
        BUCKET_INVENTORY: 3,
        BUCKET_STORE: 0,
        BUCKET_VAULT: 0,
    }


def test_two_cases_can_sit_in_different_buckets(client, make_product):
    """The thing that was impossible before: one product, two places.

    `storage_location` was a single text field on the product, so buying two and sending one
    to the Store and one to the Vault could not be expressed at all.
    """
    product = make_product()
    buy(client, product["id"], 2, "600.00")

    assert move(client, product["id"], 1, BUCKET_INVENTORY, BUCKET_VAULT).status_code == 201

    assert buckets(client, product["id"]) == {
        BUCKET_INVENTORY: 1,
        BUCKET_STORE: 0,
        BUCKET_VAULT: 1,
    }


def test_moving_never_changes_how_much_there_is(client, make_product):
    """The invariant. Buckets are a view over the same stock, not extra stock."""
    product = make_product()
    buy(client, product["id"], 6, "900.00")
    before = client.get(f"/api/v1/products/{product['id']}").json()["stats"]

    move(client, product["id"], 4, BUCKET_INVENTORY, BUCKET_STORE)
    move(client, product["id"], 1, BUCKET_INVENTORY, BUCKET_VAULT)

    after = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert after["quantity_on_hand"] == before["quantity_on_hand"] == 6
    assert sum(after["by_bucket"].values()) == 6
    assert after["by_bucket"] == {BUCKET_INVENTORY: 1, BUCKET_STORE: 4, BUCKET_VAULT: 1}


def test_moving_never_changes_what_it_cost(client, make_product):
    """Cost basis follows the purchase lot, not the bucket.

    This is why the costing engine never has to know buckets exist, and why the migration
    leaves `cost_allocations` completely untouched.
    """
    product = make_product()
    buy(client, product["id"], 4, "400.00")
    before = client.get(f"/api/v1/products/{product['id']}").json()["stats"]

    move(client, product["id"], 2, BUCKET_INVENTORY, BUCKET_VAULT)

    after = client.get(f"/api/v1/products/{product['id']}").json()["stats"]
    assert after["remaining_cost"] == before["remaining_cost"] == "400.00"
    assert after["average_unit_cost"] == before["average_unit_cost"] == "100.00"


def test_selling_draws_from_the_bucket_it_was_sold_from(client, make_product):
    product = make_product()
    buy(client, product["id"], 5, "500.00")
    move(client, product["id"], 3, BUCKET_INVENTORY, BUCKET_STORE)

    client.post(
        "/api/v1/sales",
        json={
            "product_id": product["id"],
            "quantity": 2,
            "amount": "300.00",
            "bucket": BUCKET_STORE,
        },
    )

    assert buckets(client, product["id"]) == {
        BUCKET_INVENTORY: 2,
        BUCKET_STORE: 1,
        BUCKET_VAULT: 0,
    }


def test_you_cannot_move_stock_a_bucket_does_not_hold(client, make_product):
    """Unlike overselling, which records something that really happened.

    A sale can exceed stock because the sale is real and the ledger is behind. Moving boxes
    out of a bucket that has none describes nothing that occurred, so the honest fix is the
    data, not a permissive flag.
    """
    product = make_product()
    buy(client, product["id"], 2, "200.00")

    response = move(client, product["id"], 3, BUCKET_INVENTORY, BUCKET_STORE)

    assert response.status_code == 409
    assert "inventory holds 2" in response.json()["detail"]
    assert buckets(client, product["id"])[BUCKET_INVENTORY] == 2


def test_a_move_needs_two_different_buckets(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")

    assert move(client, product["id"], 1, BUCKET_STORE, BUCKET_STORE).status_code == 422


@pytest.mark.parametrize("bucket", ["basement", "", "INVENTORY"])
def test_unknown_buckets_are_rejected(client, make_product, bucket):
    product = make_product()

    response = client.post(
        "/api/v1/purchases",
        json={"product_id": product["id"], "quantity": 1, "amount": "10.00", "bucket": bucket},
    )
    assert response.status_code == 422


def test_a_move_appears_in_history_without_moving_the_quantity_column(client, make_product):
    """History sums its quantity column. A move must contribute zero to it."""
    product = make_product()
    buy(client, product["id"], 3, "300.00")
    move(client, product["id"], 2, BUCKET_INVENTORY, BUCKET_VAULT, notes="long term play")

    history = client.get(f"/api/v1/products/{product['id']}").json()["history"]
    row = next(entry for entry in history if entry["kind"] == "move")

    assert row["quantity"] == 0
    assert row["from_bucket"] == BUCKET_INVENTORY
    assert row["bucket"] == BUCKET_VAULT
    assert row["label"] == "2 moved"
    assert row["notes"] == "long term play"
    assert sum(entry["quantity"] for entry in history) == 3


def test_voiding_a_move_puts_the_stock_back(client, make_product):
    product = make_product()
    buy(client, product["id"], 4, "400.00")
    moved = move(client, product["id"], 3, BUCKET_INVENTORY, BUCKET_STORE).json()

    client.post(f"/api/v1/moves/{moved['id']}/void", json={"reason": "wrong pile"})

    assert buckets(client, product["id"]) == {
        BUCKET_INVENTORY: 4,
        BUCKET_STORE: 0,
        BUCKET_VAULT: 0,
    }


def test_voiding_a_move_twice_is_a_conflict(client, make_product):
    product = make_product()
    buy(client, product["id"], 2, "200.00")
    moved = move(client, product["id"], 1, BUCKET_INVENTORY, BUCKET_VAULT).json()

    client.post(f"/api/v1/moves/{moved['id']}/void", json={"reason": "wrong pile"})
    again = client.post(f"/api/v1/moves/{moved['id']}/void", json={"reason": "again"})

    assert again.status_code == 409


def test_moving_against_a_missing_product_is_a_404(client):
    response = move(
        client,
        "00000000-0000-0000-0000-000000000000",
        1,
        BUCKET_INVENTORY,
        BUCKET_STORE,
    )
    assert response.status_code == 404


def test_the_move_records_when_it_happened(client, make_product):
    """"Moved to Vault after 180 days in Store" needs the date to be on the row."""
    product = make_product()
    buy(client, product["id"], 1, "100.00", bucket=BUCKET_STORE)
    when = TODAY - timedelta(days=180)

    moved = move(
        client,
        product["id"],
        1,
        BUCKET_STORE,
        BUCKET_VAULT,
        moved_on=when.isoformat(),
    ).json()

    assert moved["moved_on"] == when.isoformat()
    assert moved["from_bucket"] == BUCKET_STORE
    assert moved["to_bucket"] == BUCKET_VAULT


def test_the_inventory_list_can_be_filtered_to_one_bucket(client, make_product):
    vaulted = make_product("Long Hold Case")
    stored = make_product("For Sale Box")
    buy(client, vaulted["id"], 1, "900.00", bucket=BUCKET_VAULT)
    buy(client, stored["id"], 1, "150.00", bucket=BUCKET_STORE)

    def names(bucket: str) -> list[str]:
        page = client.get(f"/api/v1/products?bucket={bucket}").json()
        return [item["name"] for item in page["items"]]

    assert names(BUCKET_VAULT) == ["Long Hold Case"]
    assert names(BUCKET_STORE) == ["For Sale Box"]
    assert names(BUCKET_INVENTORY) == []


def test_the_bucket_filter_rejects_a_bucket_that_does_not_exist(client):
    assert client.get("/api/v1/products?bucket=basement").status_code == 422


def test_an_emptied_bucket_drops_out_of_its_view(client, make_product):
    """Zero in a bucket means not there - the filter is about presence, not history."""
    product = make_product("Moved Away")
    buy(client, product["id"], 2, "200.00", bucket=BUCKET_STORE)
    move(client, product["id"], 2, BUCKET_STORE, BUCKET_VAULT)

    stored = client.get(f"/api/v1/products?bucket={BUCKET_STORE}").json()
    assert stored["items"] == []
    assert stored["total"] == 0


def test_a_product_with_only_a_move_cannot_be_deleted(client, make_product, db):
    """A move is history. Deleting the product would orphan it."""
    product = make_product()
    buy(client, product["id"], 1, "100.00", bucket=BUCKET_STORE)
    move(client, product["id"], 1, BUCKET_STORE, BUCKET_VAULT)

    assert client.delete(f"/api/v1/products/{product['id']}").status_code == 409


def test_a_sale_names_the_bucket_it_came_out_of(client, make_product):
    """The gap that shipped: the sale form never asked, so it always said Inventory.

    Everything was in the Store, the sale defaulted to Inventory, Inventory went to -1 and
    the Store stayed full. Total stock stayed right, so nothing looked wrong anywhere.
    """
    product = make_product()
    buy(client, product["id"], 1, "200.00", bucket=BUCKET_STORE)

    client.post(
        "/api/v1/sales",
        json={
            "product_id": product["id"],
            "quantity": 1,
            "amount": "300.00",
            "bucket": BUCKET_STORE,
        },
    )

    assert buckets(client, product["id"]) == {
        BUCKET_INVENTORY: 0,
        BUCKET_STORE: 0,
        BUCKET_VAULT: 0,
    }


def test_a_purchase_can_land_straight_in_the_store(client, make_product, game_id, product_type_id):
    """A case bought to sell never has to pass through Inventory first."""
    created = client.post(
        "/api/v1/products",
        json={
            "name": "Straight to the Store",
            "game_id": str(game_id),
            "product_type_id": str(product_type_id),
            "initial_purchase": {"quantity": 6, "amount": "900.00", "bucket": BUCKET_STORE},
        },
    ).json()

    assert created["stats"]["by_bucket"] == {
        BUCKET_INVENTORY: 0,
        BUCKET_STORE: 6,
        BUCKET_VAULT: 0,
    }


def test_bucket_totals_describe_what_a_tab_would_show(client, make_product):
    """Counted before the bucket filter, so a tab count is not a description of itself."""
    first = make_product("Vaulted Thing")
    second = make_product("Stored Thing")
    buy(client, first["id"], 2, "200.00", bucket=BUCKET_VAULT)
    buy(client, second["id"], 5, "500.00", bucket=BUCKET_STORE)

    everywhere = client.get("/api/v1/products").json()
    assert everywhere["bucket_totals"][BUCKET_VAULT] == 2
    assert everywhere["bucket_totals"][BUCKET_STORE] == 5

    # Narrowing to one bucket must not change what the other tabs claim.
    narrowed = client.get(f"/api/v1/products?bucket={BUCKET_VAULT}").json()
    assert narrowed["bucket_totals"] == everywhere["bucket_totals"]
    assert [item["name"] for item in narrowed["items"]] == ["Vaulted Thing"]
