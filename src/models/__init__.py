"""ORM models - import all models here so Alembic can discover them.

All models must be imported in this file for `alembic revision --autogenerate` to work.
"""

from src.models.audit import AuditLog
from src.models.ledger import CostAllocation, InventoryAdjustment, Purchase, Sale, StockMove
from src.models.member import Member
from src.models.money import MoneyAccount, MoneyMovement, MoneyPosting
from src.models.product import Product
from src.models.taxonomy import Game, ProductType

__all__ = [
    "AuditLog",
    "CostAllocation",
    "Game",
    "InventoryAdjustment",
    "Member",
    "MoneyAccount",
    "MoneyMovement",
    "MoneyPosting",
    "Product",
    "ProductType",
    "Purchase",
    "Sale",
    "StockMove",
]
