"""A product's transactions, flattened into one chronological list.

Merging server-side rather than in the UI: sorting purchases, sales and adjustments into a
single order is a decision about how history reads, and it should look the same everywhere.
Voided rows are included - they are why a number changed, which is the whole point of
keeping them.
"""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.ledger import InventoryAdjustment, Purchase, Sale
from src.schemas.ledger import TransactionRead


def product_history(db: Session, product_id: uuid.UUID) -> list[TransactionRead]:
    rows: list[tuple] = []

    for purchase in db.scalars(select(Purchase).where(Purchase.product_id == product_id)):
        rows.append(
            (
                purchase.purchase_date,
                purchase.created_at,
                TransactionRead(
                    kind="purchase",
                    id=purchase.id,
                    occurred_on=purchase.purchase_date,
                    quantity=purchase.quantity,
                    amount=purchase.landed_cost_cents,
                    base_amount=purchase.gross_amount_cents,
                    shipping=purchase.shipping_cents,
                    tax=purchase.tax_cents,
                    fees=purchase.fees_cents,
                    member_id=purchase.purchased_by_member_id,
                    label=purchase.source,
                    notes=purchase.notes,
                    status=purchase.status,
                ),
            )
        )

    for sale in db.scalars(select(Sale).where(Sale.product_id == product_id)):
        rows.append(
            (
                sale.sale_date,
                sale.created_at,
                TransactionRead(
                    kind="sale",
                    id=sale.id,
                    occurred_on=sale.sale_date,
                    quantity=-sale.quantity,
                    amount=sale.gross_amount_cents,
                    platform_fees=sale.platform_fees_cents,
                    payment_fees=sale.payment_fees_cents,
                    shipping_paid=sale.shipping_paid_cents,
                    cost=sale.cost_basis_cents,
                    profit=sale.realized_profit_cents,
                    has_unknown_cost=sale.has_unknown_cost,
                    member_id=sale.sold_by_member_id,
                    label=sale.marketplace,
                    notes=sale.notes,
                    status=sale.status,
                ),
            )
        )

    for adjustment in db.scalars(
        select(InventoryAdjustment).where(InventoryAdjustment.product_id == product_id)
    ):
        rows.append(
            (
                adjustment.adjustment_date,
                adjustment.created_at,
                TransactionRead(
                    kind="adjustment",
                    id=adjustment.id,
                    occurred_on=adjustment.adjustment_date,
                    quantity=adjustment.quantity_delta,
                    cost=adjustment.cost_removed_cents or adjustment.landed_cost_cents,
                    has_unknown_cost=adjustment.has_unknown_cost,
                    member_id=adjustment.member_id,
                    label=adjustment.reason,
                    notes=adjustment.notes,
                    status=adjustment.status,
                ),
            )
        )

    # Newest first. Undated rows are historical, so date.min sinks them to the bottom -
    # the opposite of the costing engine's order, which is about funding, not reading.
    rows.sort(key=lambda row: (row[0] or date.min, row[1]), reverse=True)
    return [row[2] for row in rows]
