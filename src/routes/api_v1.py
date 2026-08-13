"""API v1 router - wire all v1 route modules in here.

How to add a new feature:
    1. Create src/routes/your_feature.py with an APIRouter
    2. Import and include it below
"""

from fastapi import APIRouter

from src.routes.ledger import router as ledger_router
from src.routes.members import router as members_router
from src.routes.money import router as money_router
from src.routes.products import router as products_router
from src.routes.reports import router as reports_router
from src.routes.sets import router as sets_router
from src.routes.taxonomy import games_router, product_types_router

router = APIRouter(prefix="/api/v1")

router.include_router(members_router, prefix="/members", tags=["members"])
router.include_router(products_router, prefix="/products", tags=["products"])
router.include_router(sets_router, prefix="/sets", tags=["sets"])
router.include_router(games_router, prefix="/games", tags=["taxonomy"])
router.include_router(product_types_router, prefix="/product-types", tags=["taxonomy"])
router.include_router(ledger_router, tags=["ledger"])
router.include_router(money_router, prefix="/money", tags=["money"])
router.include_router(reports_router, tags=["reports"])
