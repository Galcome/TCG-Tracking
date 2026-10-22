"""Full copies of what a product delete removes, so the delete can be undone as a last resort.

A delete takes a product's purchases, sales, moves, adjustments, valuations, price history and
the money that funded or came from them. Its audit row keeps every column of every one of
those rows, keyed by table, and recovery inserts them back with their original ids - so
anything that pointed at them before (other audit rows, the money ledger) lines up again.

Cost allocations are not kept: they are derived, and the restore rebuilds them with FIFO.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Column, Table, insert, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import ColumnElement

from src.models.catalog import CatalogMapping
from src.models.ledger import InventoryAdjustment, Purchase, Sale, StockMove
from src.models.market_price import CurrentMarketQuote, MarketPriceSnapshot
from src.models.money import MoneyMovement, MoneyPosting
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product

#: Parents before children, which is the order they have to go back in.
TABLES: tuple[Table, ...] = tuple(
    model.__table__  # type: ignore[misc]
    for model in (
        Product,
        CatalogMapping,
        CurrentMarketQuote,
        MarketPriceSnapshot,
        PriceSnapshot,
        Purchase,
        Sale,
        InventoryAdjustment,
        StockMove,
        MoneyMovement,
        MoneyPosting,
    )
)


def _scope(table: Table, product_id: uuid.UUID) -> ColumnElement[bool]:
    """Which rows of `table` belong to the product."""
    if table is Product.__table__:
        return Product.id == product_id
    movements = select(MoneyMovement.id).where(
        MoneyMovement.purchase_id.in_(select(Purchase.id).where(Purchase.product_id == product_id))
        | MoneyMovement.sale_id.in_(select(Sale.id).where(Sale.product_id == product_id))
    )
    if table is MoneyMovement.__table__:
        return MoneyMovement.id.in_(movements)
    if table is MoneyPosting.__table__:
        return MoneyPosting.movement_id.in_(movements)
    return table.c.product_id == product_id


def _encode(value: Any) -> Any:
    if isinstance(value, uuid.UUID | Decimal):
        return str(value)
    if isinstance(value, date):  # datetimes too
        return value.isoformat()
    return value


def _decode(column: Column[Any], value: Any) -> Any:
    if value is None:
        return None
    kind = column.type.python_type
    if kind is uuid.UUID:
        return uuid.UUID(value)
    if kind is datetime:
        return datetime.fromisoformat(value)
    if kind is date:
        return date.fromisoformat(value)
    if kind is Decimal:
        return Decimal(value)
    return value


def _stored(table: Table) -> list[Column[Any]]:
    # Generated columns (the product search text) are rebuilt by the database.
    return [column for column in table.columns if column.computed is None]


def capture(db: Session, product_id: uuid.UUID) -> dict[str, list[dict[str, Any]]]:
    """Every row a delete of this product would remove, as JSON-safe column values."""
    records: dict[str, list[dict[str, Any]]] = {}
    for table in TABLES:
        columns = _stored(table)
        rows = db.execute(
            select(*columns).where(_scope(table, product_id)).order_by(table.c.id)
        ).all()
        if rows:
            records[table.name] = [
                {column.name: _encode(value) for column, value in zip(columns, row, strict=True)}
                for row in rows
            ]
    return records


def restore(db: Session, records: dict[str, list[dict[str, Any]]]) -> None:
    """Insert captured rows back exactly as they were. Raises IntegrityError on a conflict."""
    for table in TABLES:
        rows = records.get(table.name)
        if not rows:
            continue
        db.execute(
            insert(table),
            [
                {
                    column.name: _decode(column, row[column.name])
                    for column in _stored(table)
                    if column.name in row
                }
                for row in rows
            ],
        )
