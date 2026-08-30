"""ORM models - import all models here so Alembic can discover them.

All models must be imported in this file for `alembic revision --autogenerate` to work.
"""

from src.models.audit import AuditLog
from src.models.card_set import CardSet
from src.models.catalog import CatalogMapping
from src.models.grading import GradingSubmission
from src.models.ledger import CostAllocation, InventoryAdjustment, Purchase, Sale, StockMove
from src.models.market_price import CurrentMarketQuote, MarketPriceSnapshot
from src.models.member import Member
from src.models.money import MoneyAccount, MoneyMovement, MoneyPosting
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product
from src.models.taxonomy import Game, ProductType
from src.models.transformation import Transformation, TransformationOutput

__all__ = [
    "AuditLog",
    "CardSet",
    "CatalogMapping",
    "CostAllocation",
    "CurrentMarketQuote",
    "Game",
    "GradingSubmission",
    "InventoryAdjustment",
    "Member",
    "MarketPriceSnapshot",
    "MoneyAccount",
    "MoneyMovement",
    "MoneyPosting",
    "PriceSnapshot",
    "Product",
    "ProductType",
    "Purchase",
    "Sale",
    "Transformation",
    "TransformationOutput",
    "StockMove",
]
