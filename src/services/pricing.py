"""Free, display-only market estimates.

The ledger owns money spent and money received. This service only reads manually confirmed
catalog mappings, fetches a public quote, and writes a separate current quote plus history.
It has no scheduler; the authenticated refresh endpoint can be called by a later job.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.catalog import CATALOG_PROVIDER_TCGCSV, MAPPING_CONFIRMED, CatalogMapping
from src.models.market_price import (
    QUOTE_FRESH,
    QUOTE_STALE,
    QUOTE_UNAVAILABLE,
    CurrentMarketQuote,
    MarketPriceSnapshot,
)
from src.models.product import Product

logger = logging.getLogger(__name__)

TCGCSV_BASE_URL = "https://tcgcsv.com"
TCGCSV_LAST_UPDATED_URL = f"{TCGCSV_BASE_URL}/last-updated.txt"
BOC_USD_CAD_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json"
HTTP_TIMEOUT_SECONDS = 10
MAX_PROVIDER_RESPONSE_BYTES = 25 * 1024 * 1024
USER_AGENT = "TCG-Tracking/0.1"
FX_LOOKBACK_DAYS = 7
TCGCSV_REQUEST_DELAY_SECONDS = 0.1
MARKET_QUOTE_STALE_DAYS = 3

# A generic `single` is allowed because older records use it for raw cards. Graded cards
# still fail the independent grading-field check below, even if someone misclassified them.
ELIGIBLE_PRODUCT_TYPE_SLUGS = frozenset(
    {"single", "raw-single", "booster-box", "sealed-case"}
)


class PricingError(RuntimeError):
    """A provider response cannot safely become a quote."""


class QuoteUnavailable(PricingError):
    """The provider has the product but no usable market quote for it."""


def _http_get(url: str, *, accept: str = "application/json") -> bytes:
    """Fetch a bounded response with the provider's required identification header."""
    request = Request(url, headers={"Accept": accept, "User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            if getattr(response, "status", 200) != 200:
                raise PricingError("provider returned an unsuccessful response")
            body = response.read(MAX_PROVIDER_RESPONSE_BYTES + 1)
    except PricingError:
        raise
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        raise PricingError("provider request failed") from error
    if len(body) > MAX_PROVIDER_RESPONSE_BYTES:
        raise PricingError("provider response was too large")
    return body


def _json(body: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(body)
    except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PricingError("provider returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise PricingError("provider returned an invalid payload")
    return payload


def _decimal(value: object, *, message: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as error:
        raise PricingError(message) from error
    if not parsed.is_finite() or parsed < 0:
        raise PricingError(message)
    return parsed


def _positive_decimal(value: object, *, message: str) -> Decimal:
    parsed = _decimal(value, message=message)
    if parsed <= 0:
        raise PricingError(message)
    return parsed


def _cents(value: Decimal) -> int:
    """Round one decimal-currency amount to integer cents, never binary floats."""
    return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _normalise_subtype(value: object) -> str:
    # TCGCSV uses Normal for the ordinary printing; treating a missing source subtype as
    # Normal lets an explicit Normal mapping work without guessing another variant.
    text = str(value or "").strip()
    return (text or "Normal").casefold()


def _marker_date(value: str) -> date:
    match = re.search(r"\d{4}-\d{2}-\d{2}", value)
    if match is None:
        raise PricingError("provider update marker had no usable date")
    try:
        return date.fromisoformat(match.group(0))
    except ValueError as error:
        raise PricingError("provider update marker had no usable date") from error


@dataclass(frozen=True)
class FeedRevision:
    value: str
    as_of: date


@dataclass(frozen=True)
class ProviderQuote:
    original_value: Decimal
    currency: str
    source_revision: FeedRevision


class TCGCSVProvider:
    """Read TCGCSV's once-daily cached group price files."""

    def __init__(
        self,
        get_bytes: Callable[..., bytes] | None = None,
        pause: Callable[[float], None] | None = None,
    ):
        self._get_bytes = get_bytes or _http_get
        self._pause = pause or time.sleep
        self._prices_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}

    def latest_update(self) -> FeedRevision:
        try:
            raw = self._get_bytes(TCGCSV_LAST_UPDATED_URL, accept="text/plain").decode("utf-8")
        except (UnicodeDecodeError, TypeError) as error:
            raise PricingError("provider update marker was invalid") from error
        marker = raw.strip()
        if not marker:
            raise PricingError("provider update marker was empty")
        return FeedRevision(marker[:120], _marker_date(marker))

    def _prices(self, category_id: str, group_id: str) -> list[dict[str, Any]]:
        if not category_id.isdigit() or not group_id.isdigit():
            raise PricingError("TCGCSV mapping has invalid category or group")
        key = (category_id, group_id)
        if key not in self._prices_cache:
            # TCGCSV explicitly asks backend importers to leave 100 ms between files.
            # Refresh is a synchronous, member-triggered maintenance operation running in
            # FastAPI's threadpool, so this courtesy delay does not block the event loop.
            self._pause(TCGCSV_REQUEST_DELAY_SECONDS)
            url = f"{TCGCSV_BASE_URL}/tcgplayer/{category_id}/{group_id}/prices"
            payload = _json(self._get_bytes(url))
            if payload.get("success") is not True or not isinstance(payload.get("results"), list):
                raise PricingError("TCGCSV price response was invalid")
            self._prices_cache[key] = [
                item for item in payload["results"] if isinstance(item, dict)
            ]
        return self._prices_cache[key]

    def quote_for(self, mapping: CatalogMapping, revision: FeedRevision) -> ProviderQuote:
        category_id = (mapping.external_category_id or "").strip()
        group_id = (mapping.external_group_id or "").strip()
        product_id = mapping.external_product_id.strip()
        subtype = _normalise_subtype(mapping.subtype_name)
        for item in self._prices(category_id, group_id):
            if str(item.get("productId")) != product_id:
                continue
            if _normalise_subtype(item.get("subTypeName")) != subtype:
                continue
            raw_price = item.get("marketPrice")
            if raw_price is None:
                raise QuoteUnavailable("TCGCSV has no market price for this printing")
            return ProviderQuote(
                original_value=_decimal(raw_price, message="TCGCSV returned an invalid price"),
                currency="USD",
                source_revision=revision,
            )
        raise QuoteUnavailable("TCGCSV has no matching price for this mapping")


@dataclass(frozen=True)
class ExchangeRate:
    rate: Decimal
    as_of: date


class BankOfCanadaProvider:
    """Read the Bank of Canada's public daily USD/CAD Valet series."""

    def __init__(self, get_bytes: Callable[..., bytes] | None = None):
        self._get_bytes = get_bytes or _http_get

    def usd_cad(self, on_or_before: date) -> ExchangeRate:
        start = on_or_before - timedelta(days=FX_LOOKBACK_DAYS)
        url = (
            f"{BOC_USD_CAD_URL}?start_date={start.isoformat()}"
            f"&end_date={on_or_before.isoformat()}"
        )
        observations = _json(self._get_bytes(url)).get("observations")
        if not isinstance(observations, list):
            raise PricingError("Bank of Canada response was invalid")

        found: list[ExchangeRate] = []
        for observation in observations:
            if not isinstance(observation, dict):
                continue
            observed_on = observation.get("d")
            values = observation.get("FXUSDCAD")
            raw_rate = values.get("v") if isinstance(values, dict) else None
            if not isinstance(observed_on, str) or raw_rate is None:
                continue
            try:
                observed_date = date.fromisoformat(observed_on)
            except ValueError:
                continue
            if start <= observed_date <= on_or_before:
                found.append(
                    ExchangeRate(
                        rate=_positive_decimal(
                            raw_rate, message="Bank of Canada returned an invalid rate"
                        ),
                        as_of=observed_date,
                    )
                )
        if not found:
            raise PricingError("Bank of Canada has no recent USD/CAD rate")
        return max(found, key=lambda item: item.as_of)


@dataclass(frozen=True)
class MarketEstimate:
    """A quote safe to display, but never safe to use as accounting."""

    value_cents: int | None
    captured_on: date | None
    status: str
    provider: str
    source_revision: str | None


@dataclass(frozen=True)
class RefreshSummary:
    attempted: int
    refreshed: int
    skipped: int
    stale: int
    unavailable: int
    source_revision: str | None
    errors: tuple[str, ...]


def is_pricing_eligible(product: Product) -> bool:
    """Only raw/sealed products with no grading identity may receive a free quote."""
    product_type = getattr(getattr(product, "product_type", None), "slug", None)
    if product_type not in ELIGIBLE_PRODUCT_TYPE_SLUGS:
        return False
    return not any(
        str(getattr(product, field, None) or "").strip()
        for field in ("grading_company", "grade", "cert_number")
    )


def eligibility_error(product: Product) -> str:
    if (
        getattr(getattr(product, "product_type", None), "slug", None) == "graded-card"
        or any(
            str(getattr(product, field, None) or "").strip()
            for field in ("grading_company", "grade", "cert_number")
        )
    ):
        return "Market pricing is manual for graded products."
    return "Market pricing supports raw cards, booster boxes, and sealed cases only."


def current_estimates(
    db: Session,
    product_ids: list[Any] | None = None,
    *,
    today: date | None = None,
) -> dict[Any, MarketEstimate]:
    """Return current display quotes, hiding mappings explicitly disabled by an operator."""
    stmt = (
        select(CurrentMarketQuote, CatalogMapping)
        .join(CatalogMapping, CatalogMapping.id == CurrentMarketQuote.mapping_id)
        .where(CatalogMapping.match_status == MAPPING_CONFIRMED)
        .order_by(CurrentMarketQuote.updated_at.desc())
    )
    if product_ids is not None:
        if not product_ids:
            return {}
        stmt = stmt.where(CurrentMarketQuote.product_id.in_(product_ids))

    reference = today or date.today()
    estimates: dict[Any, MarketEstimate] = {}
    for quote, mapping in db.execute(stmt):
        if quote.product_id in estimates:
            continue
        # A product can become graded after its raw-card mapping was confirmed. Never
        # surface that old raw quote as a slab estimate; the mapping remains available
        # for audit or for an operator to disable explicitly.
        if not is_pricing_eligible(mapping.product):
            continue
        status = quote.status
        if (
            status == QUOTE_FRESH
            and quote.source_as_of is not None
            and (reference - quote.source_as_of).days > MARKET_QUOTE_STALE_DAYS
        ):
            status = QUOTE_STALE
        estimates[quote.product_id] = MarketEstimate(
            value_cents=quote.cad_value_cents,
            captured_on=quote.source_as_of,
            status=status,
            provider=mapping.provider,
            source_revision=quote.source_revision,
        )
    return estimates


def _record_failure(
    db: Session,
    mapping: CatalogMapping,
    current: CurrentMarketQuote | None,
    attempted_at: datetime,
    message: str,
) -> tuple[CurrentMarketQuote, bool]:
    if current is None:
        current = CurrentMarketQuote(mapping_id=mapping.id, product_id=mapping.product_id)
        db.add(current)
    had_value = current.cad_value_cents is not None
    current.status = QUOTE_STALE if had_value else QUOTE_UNAVAILABLE
    current.last_attempted_at = attempted_at
    current.error_message = message
    return current, had_value


def refresh(
    db: Session,
    *,
    today: date | None = None,
    now: datetime | None = None,
    provider: TCGCSVProvider | None = None,
    fx: BankOfCanadaProvider | None = None,
) -> RefreshSummary:
    """Refresh confirmed mappings once for the provider's current daily revision."""
    reference = today or date.today()
    attempted_at = now or datetime.now(UTC)
    mappings = list(
        db.scalars(
            select(CatalogMapping)
            .where(CatalogMapping.match_status == MAPPING_CONFIRMED)
            .order_by(CatalogMapping.id)
        )
    )
    if not mappings:
        return RefreshSummary(0, 0, 0, 0, 0, None, ())

    provider = provider or TCGCSVProvider()
    fx = fx or BankOfCanadaProvider()
    current_by_mapping = {
        quote.mapping_id: quote
        for quote in db.scalars(
            select(CurrentMarketQuote).where(
                CurrentMarketQuote.mapping_id.in_([mapping.id for mapping in mappings])
            )
        )
    }
    revisions: FeedRevision | None = None
    errors: list[str] = []
    try:
        revisions = provider.latest_update()
    except PricingError as error:
        message = str(error)
        stale = unavailable = 0
        for mapping in mappings:
            _, had_value = _record_failure(
                db, mapping, current_by_mapping.get(mapping.id), attempted_at, message
            )
            stale += int(had_value)
            unavailable += int(not had_value)
        db.flush()
        return RefreshSummary(
            len(mappings), 0, 0, stale, unavailable, None, (message,)
        )

    pending = []
    skipped = 0
    for mapping in mappings:
        current = current_by_mapping.get(mapping.id)
        if (
            current
            and current.status == QUOTE_FRESH
            and current.source_revision == revisions.value
            and current.last_successful_at is not None
            and current.last_successful_at.date() == reference
        ):
            skipped += 1
        else:
            pending.append(mapping)
    if not pending:
        return RefreshSummary(len(mappings), 0, skipped, 0, 0, revisions.value, ())

    try:
        exchange = fx.usd_cad(reference)
    except PricingError as error:
        message = str(error)
        stale = unavailable = 0
        for mapping in pending:
            _, had_value = _record_failure(
                db, mapping, current_by_mapping.get(mapping.id), attempted_at, message
            )
            stale += int(had_value)
            unavailable += int(not had_value)
        db.flush()
        return RefreshSummary(
            len(mappings), 0, skipped, stale, unavailable, revisions.value, (message,)
        )

    history_by_mapping: dict[Any, MarketPriceSnapshot] = {}
    for snapshot in db.scalars(
        select(MarketPriceSnapshot)
        .where(MarketPriceSnapshot.mapping_id.in_([mapping.id for mapping in pending]))
        .order_by(MarketPriceSnapshot.captured_on.desc(), MarketPriceSnapshot.fetched_at.desc())
    ):
        # Rows arrive newest-first. Do not overwrite the first one with older history.
        history_by_mapping.setdefault(snapshot.mapping_id, snapshot)
    refreshed = stale = unavailable = 0
    for mapping in pending:
        current = current_by_mapping.get(mapping.id)
        if not is_pricing_eligible(mapping.product):
            message = eligibility_error(mapping.product)
            _, had_value = _record_failure(db, mapping, current, attempted_at, message)
            stale += int(had_value)
            unavailable += int(not had_value)
            errors.append(message)
            continue
        try:
            quote = provider.quote_for(mapping, revisions)
            original_cents = _cents(quote.original_value)
            cad_cents = _cents(quote.original_value * exchange.rate)
        except QuoteUnavailable as error:
            message = str(error)
            _, had_value = _record_failure(db, mapping, current, attempted_at, message)
            stale += int(had_value)
            unavailable += int(not had_value)
            errors.append(message)
            continue
        except PricingError as error:
            message = str(error)
            _, had_value = _record_failure(db, mapping, current, attempted_at, message)
            stale += int(had_value)
            unavailable += int(not had_value)
            errors.append(message)
            continue

        if current is None:
            current = CurrentMarketQuote(mapping_id=mapping.id, product_id=mapping.product_id)
            db.add(current)
            current_by_mapping[mapping.id] = current
        current.status = QUOTE_FRESH
        current.original_currency = quote.currency
        current.original_value_cents = original_cents
        current.cad_value_cents = cad_cents
        current.fx_rate = exchange.rate
        current.fx_as_of = exchange.as_of
        current.source_revision = revisions.value
        current.source_as_of = revisions.as_of
        current.last_attempted_at = attempted_at
        current.last_successful_at = attempted_at
        current.error_message = None

        previous = history_by_mapping.get(mapping.id)
        monthly_checkpoint_due = previous is not None and (
            previous.captured_on.year,
            previous.captured_on.month,
        ) != (reference.year, reference.month)
        provider_price_changed = (
            previous is not None and previous.original_value_cents != original_cents
        )
        identity_changed = previous is not None and (
            previous.external_product_id != mapping.external_product_id
            or previous.subtype_name.casefold() != mapping.subtype_name.casefold()
            or previous.condition != mapping.condition
        )
        if (
            previous is None
            or provider_price_changed
            or identity_changed
            or monthly_checkpoint_due
        ):
            db.add(
                MarketPriceSnapshot(
                    mapping_id=mapping.id,
                    product_id=mapping.product_id,
                    provider=mapping.provider,
                    external_product_id=mapping.external_product_id,
                    subtype_name=mapping.subtype_name,
                    condition=mapping.condition,
                    original_currency=quote.currency,
                    original_value_cents=original_cents,
                    cad_value_cents=cad_cents,
                    fx_rate=exchange.rate,
                    fx_as_of=exchange.as_of,
                    source_revision=revisions.value,
                    source_as_of=revisions.as_of,
                    captured_on=reference,
                    fetched_at=attempted_at,
                )
            )
        refreshed += 1

    db.flush()
    return RefreshSummary(
        len(mappings), refreshed, skipped, stale, unavailable, revisions.value, tuple(errors[:20])
    )


__all__ = [
    "BOC_USD_CAD_URL",
    "CATALOG_PROVIDER_TCGCSV",
    "ELIGIBLE_PRODUCT_TYPE_SLUGS",
    "ExchangeRate",
    "FeedRevision",
    "HTTP_TIMEOUT_SECONDS",
    "MARKET_QUOTE_STALE_DAYS",
    "MarketEstimate",
    "PricingError",
    "ProviderQuote",
    "QuoteUnavailable",
    "RefreshSummary",
    "TCGCSVProvider",
    "TCGCSV_REQUEST_DELAY_SECONDS",
    "BankOfCanadaProvider",
    "current_estimates",
    "eligibility_error",
    "is_pricing_eligible",
    "refresh",
]
