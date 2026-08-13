"""Product routes: creation, retrieval, editing, deletion and forgiving search."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from src.database import Base
from src.dependencies import db_session, get_current_member
from src.models.ledger import BUCKETS, Purchase
from src.models.member import Member
from src.models.product import Product
from src.models.taxonomy import Game, ProductType
from src.routes.money import resolve_funding
from src.schemas.product import (
    EMPTY_STATS,
    ProductCreate,
    ProductDetail,
    ProductList,
    ProductRead,
    ProductStatsRead,
    ProductUpdate,
)
from src.services import history, inventory, ledger, sets
from src.services import money as money_service
from src.services.search import escape_like

router = APIRouter()

DEFAULT_LIMIT = 50
MAX_LIMIT = 200

# word_similarity() scores the query against the best-matching run of words in the
# target, so a short query still scores well against a long concatenated search_text.
# 0.35 catches ordinary typos ("vivd voltage") without returning the whole table.
SIMILARITY_THRESHOLD = 0.35

STOCK_IN = "in"
STOCK_OUT = "out"


def _attach_set(
    db: Session,
    fields: dict,
    *,
    game_id: uuid.UUID,
    member_id: uuid.UUID | None,
) -> None:
    """Turn a typed `set_name` into a real set, in place.

    Writes both `set_id` - the identity everything groups by - and `set_name`, the copy the
    generated search column reads. Both come from the set's own name, so "fabled" saves as
    "Fabled" and stops being a second row in every report that groups by set.
    """
    if "set_name" not in fields:
        return

    typed = fields.pop("set_name")
    record = (
        sets.resolve(db, game_id=game_id, name=typed, member_id=member_id) if typed else None
    )
    fields["set_id"] = record.id if record else None
    fields["set_name"] = record.name if record else None


def _require_taxonomy(db: Session, model: type[Base], record_id: uuid.UUID, label: str) -> None:
    if db.get(model, record_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown {label}",
        )


def _stats_for(stats_by_product: dict, product_id: uuid.UUID) -> ProductStatsRead:
    """Products with no transactions still need a stats block, all zeroes."""
    found = stats_by_product.get(product_id)
    return ProductStatsRead.model_validate(found) if found else ProductStatsRead(**EMPTY_STATS)


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
        pattern = f"%{escape_like(q)}%"
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
    stock: str | None = Query(default=None, description="in | out"),
    bucket: str | None = Query(
        default=None, pattern=f"^({'|'.join(BUCKETS)})$", description="inventory | store | vault"
    ),
    include_archived: bool = Query(default=False),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> ProductList:
    """Search and filter products, each with its derived stock and cost figures.

    Matching is forgiving: exact substring OR trigram similarity, so partial words and
    small misspellings still find the item.
    """
    search = (q or "").strip() or None

    # Stock is an aggregate over four tables, so it lives in a subquery the database can
    # join, filter and page on. It used to be applied in Python, which meant loading the
    # whole catalogue and computing cost basis for every product to show fifty - fine at a
    # few hundred, and it was already slowing the e2e suite past its timeouts.
    totals = inventory.stock_totals()
    on_hand = func.coalesce(totals.c.on_hand, 0)

    def matching() -> Select:
        """Everything the search, taxonomy and stock filters keep. Not the bucket filter."""
        stmt = select(Product).outerjoin(totals, totals.c.product_id == Product.id)
        stmt = _apply_filters(stmt, search, game, product_type, include_archived)
        if stock == STOCK_IN:
            # Deliberately `!= 0`, so negative stock stays visible. An oversell means the
            # ledger disagrees with the shelf, and this list is where that gets fixed.
            return stmt.where(on_hand != 0)
        if stock == STOCK_OUT:
            return stmt.where(on_hand == 0)
        return stmt

    # Counted before the bucket filter narrows anything, so a tab's count says what
    # pressing it would show rather than what is already on screen.
    counted = db.execute(
        select(*[func.coalesce(func.sum(totals.c[name]), 0) for name in BUCKETS]).where(
            totals.c.product_id.in_(matching().with_only_columns(Product.id))
        )
    ).one()
    bucket_totals = {name: int(value) for name, value in zip(BUCKETS, counted)}

    narrowed = matching()
    if bucket is not None:
        # Zero in a bucket means not there, so a product with 3 in the Vault and none in
        # the Store is absent from the Store view.
        narrowed = narrowed.where(func.coalesce(totals.c[bucket], 0) > 0)

    total = db.scalar(
        select(func.count()).select_from(narrowed.with_only_columns(Product.id).subquery())
    )

    if search:
        narrowed = narrowed.order_by(
            func.word_similarity(search, Product.search_text).desc(),
            Product.name.asc(),
            Product.id.asc(),
        )
    else:
        narrowed = narrowed.order_by(Product.name.asc(), Product.id.asc())

    page = db.scalars(narrowed.limit(limit).offset(offset)).unique().all()

    # Cost basis and profit are only ever wanted for what is on screen.
    stats_by_product = inventory.product_stats(db, [item.id for item in page])
    for item in page:
        item.stats = _stats_for(stats_by_product, item.id)

    return ProductList(
        items=[ProductRead.model_validate(item, from_attributes=True) for item in page],
        total=total or 0,
        limit=limit,
        offset=offset,
        bucket_totals=bucket_totals,
    )


@router.post("", response_model=ProductDetail, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> ProductDetail:
    """Create a product, optionally with the purchase that brought it into stock.

    Both happen in one transaction: a product created without the cost that came with it
    is exactly the gap this app exists to close.
    """
    _require_taxonomy(db, Game, payload.game_id, "game")
    _require_taxonomy(db, ProductType, payload.product_type_id, "product type")

    fields = payload.model_dump(exclude={"initial_purchase"})
    _attach_set(db, fields, game_id=payload.game_id, member_id=member.id)

    product = Product(**fields, created_by_member_id=member.id)
    db.add(product)
    db.flush()

    if payload.initial_purchase is not None:
        opening = payload.initial_purchase
        purchase = Purchase(
            product_id=product.id,
            quantity=opening.quantity,
            gross_amount_cents=opening.amount,
            shipping_cents=opening.shipping,
            tax_cents=opening.tax,
            fees_cents=opening.fees,
            purchase_date=opening.purchase_date,
            purchased_by_member_id=opening.purchased_by_member_id or member.id,
            source=opening.source,
            bucket=opening.bucket,
            created_by_member_id=member.id,
        )
        db.add(purchase)
        db.flush()
        ledger.recompute_product(db, product.id)
        money_service.sync_funding(
            db,
            purchase,
            funding=resolve_funding(
                db,
                legs=opening.funding,
                landed_cost=purchase.landed_cost_cents,
                default_member_id=purchase.purchased_by_member_id or member.id,
            ),
            member_id=member.id,
        )
        ledger.record_audit(
            db,
            entity_type="purchase",
            entity_id=purchase.id,
            action="create",
            member_id=member.id,
            after=ledger.snapshot(purchase, ["quantity", "gross_amount_cents", "purchase_date"]),
        )

    db.refresh(product)
    return _detail(db, product)


def _detail(db: Session, product: Product) -> ProductDetail:
    """Attach the derived figures to the ORM row as transient attributes.

    They are not mapped columns, so nothing is persisted; it just lets one
    `model_validate` read the whole shape instead of stitching dicts together.
    """
    product.stats = _stats_for(inventory.product_stats(db, [product.id]), product.id)
    product.history = history.product_history(db, product.id)
    return ProductDetail.model_validate(product, from_attributes=True)


@router.get("/{product_id}", response_model=ProductDetail)
def read_product(
    product_id: uuid.UUID,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> ProductDetail:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return _detail(db, product)


@router.patch("/{product_id}", response_model=ProductDetail)
def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> ProductDetail:
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

    # The set is resolved against whichever game the product ends up on, so moving a
    # product between games re-homes its set rather than pointing at another game's.
    _attach_set(
        db,
        changes,
        game_id=changes.get("game_id", product.game_id),
        member_id=None,
    )

    for field, value in changes.items():
        setattr(product, field, value)

    db.flush()
    db.refresh(product)
    return _detail(db, product)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: uuid.UUID,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> Response:
    """Delete a product created by mistake.

    Only when nothing financial references it, voided rows included. A product with
    history gets archived instead - deleting it would take the money with it.
    """
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    if inventory.has_any_transactions(db, product_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This product has transaction history and cannot be deleted. "
                "Archive it instead to hide it without losing the record."
            ),
        )

    db.delete(product)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
