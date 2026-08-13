"""The three reports that make the transformation chain worth having.

They answer different questions and are deliberately kept apart:

**Lineage** - this one case, all-in, across everything it became. The "we got lucky on that
Fabled case" story, told in numbers rather than memory.

**Tier** - cases return X% over N days, boxes Y%, hits Z%. Compares strategies across
everything ever bought, and reports the **spread** as well as the average, because the case
people remember is the one that hit. A report that only ever surfaces winners will always
conclude that ripping pays.

**Set** - one set, split into what sold, what is still in the Store, and what is in the
Vault, shown as parts and never blended.

Lineage and tier **overlap by definition**: a case's lineage return *is* the aggregate of
its descendants, so a single total combining both would double count. They are separate
views and are never summed. The same rule that keeps the Vault out of the ageing average.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.card_set import CardSet
from src.models.ledger import BUCKET_STORE, BUCKET_VAULT, STATUS_ACTIVE, Purchase, Sale
from src.models.product import Product
from src.models.taxonomy import ProductType
from src.models.transformation import Transformation, TransformationOutput
from src.services import inventory


@dataclass
class LineageNode:
    """One product in a chain, and what it became."""

    product_id: uuid.UUID
    product_name: str
    #: How deep below the root. 0 is the root itself.
    depth: int
    quantity_produced: int
    cost_cents: int | None
    children: list[LineageNode] = field(default_factory=list)


@dataclass
class LineageRollup:
    """One root, all-in, across everything it became."""

    product_id: uuid.UUID
    product_name: str
    #: What the root cost, before anything was done to it.
    cost_cents: int
    #: Realized profit from selling any of it, or anything it turned into.
    realized_profit_cents: int
    #: Cost basis still sitting in stock somewhere down the chain.
    remaining_cost_cents: int
    #: Cost lost to bulk on the way. Part of the story of what the case really returned.
    written_off_cents: int
    units_sold: int
    units_remaining: int
    tree: list[LineageNode]

    @property
    def roi(self) -> float | None:
        """Return on what went in. `None` when nothing has been sold yet.

        Deliberately measured against the root's cost, not against the descendants' - the
        question is what the *case* returned, and its cost is the only number that was ever
        really spent.
        """
        if self.cost_cents <= 0 or self.units_sold <= 0:
            return None
        return self.realized_profit_cents / self.cost_cents


def _descendants(db: Session, root_id: uuid.UUID) -> tuple[list[LineageNode], set[uuid.UUID]]:
    """Walk the transformation tree down from one product.

    Cycles cannot happen - a transformation refuses to produce its own source - but the walk
    still tracks what it has seen, because a diamond (two branches converging on the same
    product) would otherwise be counted twice.
    """
    seen: set[uuid.UUID] = {root_id}

    def walk(product_id: uuid.UUID, depth: int) -> list[LineageNode]:
        rows = db.execute(
            select(TransformationOutput, Product.name)
            .join(Transformation, Transformation.id == TransformationOutput.transformation_id)
            .join(Product, Product.id == TransformationOutput.product_id)
            .where(
                Transformation.source_product_id == product_id,
                Transformation.status == STATUS_ACTIVE,
            )
            .order_by(Product.name)
        ).all()

        nodes: list[LineageNode] = []
        for output, name in rows:
            if output.product_id in seen:
                continue
            seen.add(output.product_id)
            nodes.append(
                LineageNode(
                    product_id=output.product_id,
                    product_name=name,
                    depth=depth,
                    quantity_produced=output.quantity,
                    cost_cents=output.cost_cents,
                    children=walk(output.product_id, depth + 1),
                )
            )
        return nodes

    return walk(root_id, 1), seen


def lineage(db: Session, root_id: uuid.UUID) -> LineageRollup | None:
    """Everything one product became, and what the whole chain returned.

    "That Fabled case: 4 boxes flipped in March, 1 still in the Vault, 1 ripped into a
    graded hit" - as a number rather than a memory.
    """
    root = db.get(Product, root_id)
    if root is None:
        return None

    tree, involved = _descendants(db, root_id)
    stats = inventory.product_stats(db, list(involved))

    # What actually went in. Only the root's own non-derived purchases are real money;
    # everything below carries cost across rather than spending it again.
    spent = int(
        db.scalar(
            select(
                func.coalesce(
                    func.sum(
                        Purchase.gross_amount_cents
                        + Purchase.shipping_cents
                        + Purchase.tax_cents
                        + Purchase.fees_cents
                    ),
                    0,
                )
            ).where(
                Purchase.product_id == root_id,
                Purchase.status == STATUS_ACTIVE,
                Purchase.is_derived.is_(False),
            )
        )
        or 0
    )

    realized = 0
    remaining = 0
    written_off = 0
    sold = 0
    left = 0
    for product_id in involved:
        entry = stats.get(product_id)
        if entry is None:
            continue
        realized += entry.realized_profit_cents
        remaining += entry.remaining_cost_cents
        written_off += entry.cost_written_off_cents
        sold += entry.quantity_sold
        left += entry.quantity_on_hand

    return LineageRollup(
        product_id=root_id,
        product_name=root.name,
        cost_cents=spent,
        realized_profit_cents=realized,
        remaining_cost_cents=remaining,
        written_off_cents=written_off,
        units_sold=sold,
        units_remaining=left,
        tree=tree,
    )


@dataclass
class TierRow:
    """One product type, with the spread as well as the average."""

    key: str
    label: str
    products_traded: int
    units_sold: int
    realized_profit_cents: int
    cost_of_sales_cents: int
    #: Mean return across the *products* in this tier, not across the money. A single
    #: enormous win would otherwise drag the average up and hide that most of them lost.
    average_roi: float | None
    #: The spread, which is the whole point. "We got lucky on that case" is survivorship:
    #: the case people remember is the one that hit, and a report that only shows winners
    #: will always conclude that ripping pays.
    best_roi: float | None
    worst_roi: float | None
    median_roi: float | None
    avg_days_held: int | None

    @property
    def roi(self) -> float | None:
        """Money-weighted return, for comparing against the dashboard's own figure."""
        if self.cost_of_sales_cents <= 0:
            return None
        return self.realized_profit_cents / self.cost_of_sales_cents


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def by_tier(db: Session) -> list[TierRow]:
    """How each tier of thing has actually performed, spread included.

    Comparing a case against a box is false - a $900 case is harder to move than a $150 box
    and *should* sit longer - so tier is the grouping axis and the comparison is meant to be
    read within a row's own kind, not across them.
    """
    products = db.execute(
        select(Product.id, Product.product_type_id, ProductType.name, ProductType.slug).join(
            ProductType, ProductType.id == Product.product_type_id
        )
    ).all()
    if not products:
        return []

    stats = inventory.product_stats(db, [row[0] for row in products])

    held = dict(
        db.execute(
            select(
                Sale.product_id,
                func.avg(Sale.days_held_weighted),
            )
            .where(Sale.status == STATUS_ACTIVE, Sale.days_held_weighted.is_not(None))
            .group_by(Sale.product_id)
        ).all()
    )

    grouped: dict[str, dict] = {}
    for product_id, _type_id, label, slug in products:
        entry = stats.get(product_id)
        if entry is None or entry.sale_count == 0:
            continue
        bucket = grouped.setdefault(
            slug,
            {"label": label, "rois": [], "profit": 0, "cost": 0, "units": 0, "days": []},
        )
        bucket["profit"] += entry.realized_profit_cents
        bucket["cost"] += entry.cost_of_sales_cents
        bucket["units"] += entry.quantity_sold
        # Only products with a known cost have a return worth averaging.
        if entry.roi is not None:
            bucket["rois"].append(entry.roi)
        if product_id in held and held[product_id] is not None:
            bucket["days"].append(float(held[product_id]))

    rows = [
        TierRow(
            key=slug,
            label=values["label"],
            products_traded=len(values["rois"]),
            units_sold=values["units"],
            realized_profit_cents=values["profit"],
            cost_of_sales_cents=values["cost"],
            average_roi=(
                sum(values["rois"]) / len(values["rois"]) if values["rois"] else None
            ),
            best_roi=max(values["rois"]) if values["rois"] else None,
            worst_roi=min(values["rois"]) if values["rois"] else None,
            median_roi=_median(values["rois"]) if values["rois"] else None,
            avg_days_held=(
                round(sum(values["days"]) / len(values["days"])) if values["days"] else None
            ),
        )
        for slug, values in grouped.items()
    ]
    rows.sort(key=lambda row: (-row.realized_profit_cents, row.label))
    return rows


@dataclass
class SetRow:
    """One set, as its parts. Never a blend of them."""

    set_id: uuid.UUID
    name: str
    game_slug: str

    #: Sold: what it actually returned.
    units_sold: int
    realized_profit_cents: int
    cost_of_sales_cents: int

    #: In the Store: still trying, and how long it has been trying.
    units_in_store: int
    store_cost_cents: int
    oldest_store_days: int | None

    #: In the Vault: held on purpose. Deliberately has no ageing figure - it is not asleep.
    units_in_vault: int
    vault_cost_cents: int

    @property
    def sold_roi(self) -> float | None:
        if self.cost_of_sales_cents <= 0:
            return None
        return self.realized_profit_cents / self.cost_of_sales_cents


def by_set(db: Session, today: date | None = None) -> list[SetRow]:
    """Per set, split into what sold, what is still trying, and what is held on purpose.

    One honest header with the split beneath it, never a single blended ROI. Mixing realized
    flips with unrealized holds is the same double-count trap as summing lineage and tier -
    and a set number that quietly averages a Vault hold into a Store failure describes
    neither.
    """
    reference = today or date.today()

    rows = db.execute(
        select(Product.id, Product.set_id, CardSet.name, CardSet.game_id, Product.game_id)
        .join(CardSet, CardSet.id == Product.set_id)
        .where(Product.set_id.is_not(None))
    ).all()
    if not rows:
        return []

    from src.models.taxonomy import Game

    games = dict(db.execute(select(Game.id, Game.slug)).all())
    stats = inventory.product_stats(db, [row[0] for row in rows])

    # Oldest lot per product still sitting in stock, for the Store's ageing line.
    oldest = dict(
        db.execute(
            select(Purchase.product_id, func.min(Purchase.purchase_date))
            .where(Purchase.status == STATUS_ACTIVE, Purchase.purchase_date.is_not(None))
            .group_by(Purchase.product_id)
        ).all()
    )

    grouped: dict[uuid.UUID, dict] = {}
    for product_id, set_id, name, _set_game, product_game in rows:
        entry = stats.get(product_id)
        if entry is None:
            continue
        bucket = grouped.setdefault(
            set_id,
            {
                "name": name,
                "game": games.get(product_game, ""),
                "sold": 0,
                "profit": 0,
                "cost_of_sales": 0,
                "store_units": 0,
                "store_cost": 0,
                "vault_units": 0,
                "vault_cost": 0,
                "oldest": None,
            },
        )
        bucket["sold"] += entry.quantity_sold
        bucket["profit"] += entry.realized_profit_cents
        bucket["cost_of_sales"] += entry.cost_of_sales_cents

        on_hand = entry.quantity_on_hand
        unit_cost = entry.average_unit_cost_cents or 0
        store_units = entry.by_bucket.get(BUCKET_STORE, 0)
        vault_units = entry.by_bucket.get(BUCKET_VAULT, 0)
        bucket["store_units"] += store_units
        bucket["vault_units"] += vault_units
        bucket["store_cost"] += unit_cost * store_units if on_hand else 0
        bucket["vault_cost"] += unit_cost * vault_units if on_hand else 0

        if store_units > 0 and product_id in oldest and oldest[product_id] is not None:
            days = (reference - oldest[product_id]).days
            bucket["oldest"] = max(bucket["oldest"] or 0, days)

    result = [
        SetRow(
            set_id=set_id,
            name=values["name"],
            game_slug=values["game"],
            units_sold=values["sold"],
            realized_profit_cents=values["profit"],
            cost_of_sales_cents=values["cost_of_sales"],
            units_in_store=values["store_units"],
            store_cost_cents=values["store_cost"],
            oldest_store_days=values["oldest"],
            units_in_vault=values["vault_units"],
            vault_cost_cents=values["vault_cost"],
        )
        for set_id, values in grouped.items()
    ]
    result.sort(key=lambda row: (-row.realized_profit_cents, row.name))
    return result
