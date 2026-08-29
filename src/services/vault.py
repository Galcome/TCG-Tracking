"""The Vault: measured on appreciation, and kept out of the ageing report.

The worry that started this was misplaced, and saying so is worth more than the feature: ROI
is computed on what **sold**, and a Vault item has not sold, so it was never dragging that
number down. The distortion lives in exactly two other places.

**Ageing.** A Store box at 400 days is a problem; a Vault box at 400 days is on plan. Same
number, opposite meaning - averaging them describes neither, so the Vault is excluded from
"money asleep" outright. It is not asleep. It is parked.

**Capital.** Vault money genuinely is tied up, and "$8,000 is in the Vault" is a real
constraint on what can be spent. So it stays visible - it just must not read as a warning.

The scoreboard is different too. The Store is measured on velocity: days to sell, $/day.
The Vault is measured on **appreciation** - value against cost, annualised - which is
exactly how the workbook's own Vault tab already works, with year-over-year values and a
percentage and no days-held column anywhere.

Manual appreciation values come from `price_snapshots`, the same dated estimates the rip
screen writes. A provider market quote is attached separately when one exists; it never
replaces the manual value. Anything never valued keeps saying so rather than quietly
reporting its cost as its worth.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.ledger import BUCKET_STORE, BUCKET_VAULT, STATUS_ACTIVE, StockMove
from src.models.price_snapshot import PriceSnapshot
from src.models.product import Product
from src.services import inventory
from src.services.pricing import MarketEstimate, current_estimates


@dataclass
class VaultHolding:
    """One product held in the Vault, and what it has done since."""

    product_id: uuid.UUID
    product_name: str
    units: int
    cost_cents: int

    #: The most recent estimate, per unit, and when it was made. None means never valued -
    #: which stays None. Reporting cost as value would be inventing a number.
    value_cents: int | None
    valued_on: date | None
    #: How stale that estimate is. The workbook revalues annually; anything older than that
    #: is worth flagging rather than quietly presenting as current.
    days_since_valued: int | None

    #: How long it has been held, for annualising - not for warning about.
    days_held: int | None
    #: How long it sat in the Store before it was moved here, when it was moved. This is
    #: the loophole guard: exempting the Vault from ageing would otherwise make it the
    #: place slow stock goes to disappear.
    days_in_store_first: int | None

    #: A separate provider quote. It never replaces the manual Vault valuation above.
    market_estimate: MarketEstimate | None

    @property
    def appreciation_cents(self) -> int | None:
        if self.value_cents is None:
            return None
        return self.value_cents * self.units - self.cost_cents

    @property
    def appreciation(self) -> float | None:
        gain = self.appreciation_cents
        if gain is None or self.cost_cents <= 0:
            return None
        return gain / self.cost_cents

    @property
    def annualised(self) -> float | None:
        """Appreciation per year held. The Vault tab's own measure.

        Under a year is deliberately not extrapolated: multiplying a three-week gain by
        seventeen produces a confident number about nothing.
        """
        growth = self.appreciation
        if growth is None or self.days_held is None or self.days_held < 365:
            return None
        return growth / (self.days_held / 365)


def holdings(db: Session, today: date | None = None) -> list[VaultHolding]:
    """Everything in the Vault, biggest position first."""
    reference = today or date.today()

    stats = inventory.product_stats(db)
    vaulted = {
        product_id: entry
        for product_id, entry in stats.items()
        if entry.by_bucket.get(BUCKET_VAULT, 0) > 0
    }
    if not vaulted:
        return []

    names = dict(
        db.execute(select(Product.id, Product.name).where(Product.id.in_(vaulted))).all()
    )

    # Latest estimate per product. `distinct on` would be tidier but this stays portable
    # and the Vault is a few dozen deliberate holds, not a catalogue.
    latest: dict[uuid.UUID, tuple[int, date]] = {}
    for product_id, value, captured in db.execute(
        select(PriceSnapshot.product_id, PriceSnapshot.value_cents, PriceSnapshot.captured_on)
        .where(PriceSnapshot.product_id.in_(vaulted))
        .order_by(PriceSnapshot.captured_on.asc(), PriceSnapshot.created_at.asc())
    ):
        latest[product_id] = (int(value), captured)

    # When each one arrived in the Vault, and how long it had been in the Store first.
    arrivals = dict(
        db.execute(
            select(StockMove.product_id, func.min(StockMove.moved_on))
            .where(
                StockMove.status == STATUS_ACTIVE,
                StockMove.bucket == BUCKET_VAULT,
                StockMove.product_id.in_(vaulted),
            )
            .group_by(StockMove.product_id)
        ).all()
    )
    left_store = dict(
        db.execute(
            select(StockMove.product_id, func.min(StockMove.moved_on))
            .where(
                StockMove.status == STATUS_ACTIVE,
                StockMove.from_bucket == BUCKET_STORE,
                StockMove.bucket == BUCKET_VAULT,
                StockMove.product_id.in_(vaulted),
            )
            .group_by(StockMove.product_id)
        ).all()
    )

    market_by_product = current_estimates(db, list(vaulted))

    from src.services.transformations import source_purchase_date

    rows: list[VaultHolding] = []
    for product_id, entry in vaulted.items():
        units = entry.by_bucket[BUCKET_VAULT]
        unit_cost = entry.average_unit_cost_cents or 0
        snapshot = latest.get(product_id)
        bought = source_purchase_date(db, product_id)

        arrived = arrivals.get(product_id)
        stored_first = left_store.get(product_id)

        rows.append(
            VaultHolding(
                product_id=product_id,
                product_name=names.get(product_id, ""),
                units=units,
                cost_cents=unit_cost * units,
                value_cents=snapshot[0] if snapshot else None,
                valued_on=snapshot[1] if snapshot else None,
                days_since_valued=(reference - snapshot[1]).days if snapshot else None,
                days_held=(reference - bought).days if bought else None,
                days_in_store_first=(
                    (stored_first - bought).days
                    if stored_first is not None and bought is not None and arrived is not None
                    else None
                ),
                market_estimate=market_by_product.get(product_id),
            )
        )

    rows.sort(key=lambda row: (-row.cost_cents, row.product_name))
    return rows


def vault_units(db: Session) -> dict[uuid.UUID, int]:
    """How many units of each product are in the Vault, for the ageing report to skip."""
    return {
        product_id: entry.by_bucket.get(BUCKET_VAULT, 0)
        for product_id, entry in inventory.product_stats(db).items()
        if entry.by_bucket.get(BUCKET_VAULT, 0) > 0
    }
