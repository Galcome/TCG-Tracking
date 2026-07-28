"""Product routes: creation, retrieval, editing and forgiving search."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from src.database import Base
from src.dependencies import db_session, get_current_member
from src.models.member import Member
from src.models.product import Product
from src.models.taxonomy import Game, ProductType
from src.schemas.product import ProductCreate, ProductList, ProductRead, ProductUpdate

router = APIRouter()

DEFAULT_LIMIT = 50
MAX_LIMIT = 200

# word_similarity() scores the query against the best-matching run of words in the
# target, so a short query still scores well against a long concatenated search_text.
# 0.35 catches ordinary typos ("vivd voltage") without returning the whole table.
SIMILARITY_THRESHOLD = 0.35


def _escape_like(value: str) -> str:
    """Neutralise LIKE wildcards so a user typing '%' searches for a literal '%'."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _require_taxonomy(db: Session, model: type[Base], record_id: uuid.UUID, label: str) -> None:
    if db.get(model, record_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown {label}",
        )


def _apply_filters(
    stmt: Select,
    q: str | None,
    game: str | None,
    product_type: str | None,
    include_archived: bool,
) -> Select:
    if not include_archived:
        stmt = stmt.where(Product.is_archived.is_(False))
    if game:
        stmt = stmt.where(Product.game_id.in_(select(Game.id).where(Game.slug == game)))
    if product_type:
        stmt = stmt.where(
            Product.product_type_id.in_(
                select(ProductType.id).where(ProductType.slug == product_type)
            )
        )
    if q:
        pattern = f"%{_escape_like(q)}%"
        stmt = stmt.where(
            or_(
                Product.search_text.ilike(pattern, escape="\\"),
                func.word_similarity(q, Product.search_text) >= SIMILARITY_THRESHOLD,
            )
        )
    return stmt


@router.get("", response_model=ProductList)
def list_products(
    q: str | None = Query(default=None, max_length=200, description="Free-text search"),
    game: str | None = Query(default=None, max_length=60, description="Game slug"),
    product_type: str | None = Query(default=None, max_length=60, description="Product type slug"),
    include_archived: bool = Query(default=False),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> ProductList:
    """Search and filter products.

    Matching is forgiving: exact substring OR trigram similarity, so partial words and
    small misspellings still find the item.
    """
    search = (q or "").strip() or None

    filtered = _apply_filters(select(Product), search, game, product_type, include_archived)
    total = db.scalar(
        _apply_filters(
            select(func.count()).select_from(Product), search, game, product_type, include_archived
        )
    )

    if search:
        # Best match first; name and id keep the order total so paging is stable.
        filtered = filtered.order_by(
            func.word_similarity(search, Product.search_text).desc(),
            Product.name.asc(),
            Product.id.asc(),
        )
    else:
        filtered = filtered.order_by(Product.name.asc(), Product.id.asc())

    items = db.scalars(filtered.limit(limit).offset(offset)).unique().all()
    return ProductList(
        items=[ProductRead.model_validate(item) for item in items],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Product:
    """Create a product manually. No external catalog lookup is required."""
    _require_taxonomy(db, Game, payload.game_id, "game")
    _require_taxonomy(db, ProductType, payload.product_type_id, "product type")

    product = Product(**payload.model_dump(), created_by_member_id=member.id)
    db.add(product)
    db.flush()
    db.refresh(product)
    return product


@router.get("/{product_id}", response_model=ProductRead)
def read_product(
    product_id: uuid.UUID,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


@router.patch("/{product_id}", response_model=ProductRead)
def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    # exclude_unset so omitting a field leaves it alone, while explicitly sending
    # null still clears it.
    changes = payload.model_dump(exclude_unset=True)
    if "game_id" in changes:
        _require_taxonomy(db, Game, changes["game_id"], "game")
    if "product_type_id" in changes:
        _require_taxonomy(db, ProductType, changes["product_type_id"], "product type")

    for field, value in changes.items():
        setattr(product, field, value)

    db.flush()
    db.refresh(product)
    return product
