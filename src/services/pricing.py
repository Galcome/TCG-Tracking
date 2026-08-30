"""Free, display-only market estimates.

The ledger owns money spent and money received. This service only reads manually confirmed
catalog mappings, fetches a public quote, and writes a separate current quote plus history.
It has no scheduler; the authenticated refresh endpoint can be called by a later job.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections import OrderedDict, defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, DecimalException, InvalidOperation
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
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
TCGCSV_CATEGORIES_URL = f"{TCGCSV_BASE_URL}/tcgplayer/categories"
BOC_USD_CAD_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json"
HTTP_TIMEOUT_SECONDS = 10
MAX_PROVIDER_RESPONSE_BYTES = 25 * 1024 * 1024
USER_AGENT = "TCG-Tracking/0.1"
FX_LOOKBACK_DAYS = 7
TCGCSV_REQUEST_DELAY_SECONDS = 0.1
MARKET_QUOTE_STALE_DAYS = 3
MAX_PROVIDER_MARKET_PRICE = Decimal("1000000")
MAX_EXCHANGE_RATE = Decimal("10")
MAX_REFRESH_MAPPINGS = 100
MAX_REFRESH_GROUPS = 25
MAX_CATALOG_CATEGORIES = 200
MAX_CATALOG_GROUPS = 500
MAX_CATALOG_PRODUCTS = 50
CATALOG_CACHE_SECONDS = 24 * 60 * 60
MAX_CATALOG_CACHE_ENTRIES = 16
MAX_CATALOG_CACHE_ITEMS = 20_000
MAX_CATALOG_INDEX_PRODUCTS = 10_000
MAX_CATALOG_REQUESTS_PER_DAY = 500
MAX_CATALOG_SUBTYPES = 20
MAX_CATALOG_CONCURRENT_REQUESTS = 2
# Stable application-wide PostgreSQL advisory lock key. Transaction-scoped locking means
# the request's normal commit/rollback releases it even if a provider call fails.
PRICING_REFRESH_LOCK_KEY = 1951704321

# A generic `single` is allowed because older records use it for raw cards. Graded cards
# still fail the independent grading-field check below, even if someone misclassified them.
ELIGIBLE_PRODUCT_TYPE_SLUGS = frozenset(
    {"single", "raw-single", "booster-box", "sealed-case"}
)


class PricingError(RuntimeError):
    """A provider response cannot safely become a quote."""


class QuoteUnavailable(PricingError):
    """The provider has the product but no usable market quote for it."""


class ProviderFeedError(PricingError):
    """A group feed could not be fetched or parsed at all."""


class PricingRefreshBusy(PricingError):
    """Another refresh owns the transaction-scoped refresh lock."""


class PricingRefreshLimitExceeded(PricingError):
    """A refresh would exceed the deliberately bounded work set."""


@dataclass
class _CatalogFlight:
    """One shared catalog load, including its failure for concurrent waiters."""

    event: threading.Event
    error: PricingError | None = None


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


def _bounded_positive_decimal(value: object, *, maximum: Decimal, message: str) -> Decimal:
    parsed = _positive_decimal(value, message=message)
    if parsed > maximum:
        raise PricingError(message)
    return parsed


def _cents(value: Decimal) -> int:
    """Round one decimal-currency amount to integer cents, never binary floats."""
    try:
        rounded = (value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        cents = int(rounded)
    except (DecimalException, OverflowError, ValueError) as error:
        raise PricingError("provider currency value was invalid or out of range") from error
    if cents < 0:
        raise PricingError("provider currency value was invalid or out of range")
    return cents


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


@dataclass(frozen=True)
class CatalogCategory:
    category_id: int
    name: str
    display_name: str


@dataclass(frozen=True)
class CatalogGroup:
    group_id: int
    category_id: int
    name: str
    abbreviation: str | None
    published_on: str | None


@dataclass(frozen=True)
class CatalogProduct:
    product_id: int
    category_id: int
    group_id: int
    name: str
    clean_name: str | None
    image_url: str | None
    url: str | None
    subtypes: tuple[str, ...]


def _catalog_id(item: object, field: str) -> int | None:
    if not isinstance(item, dict):
        return None
    value = item.get(field)
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _catalog_text(item: object, field: str, *, max_length: int = 500) -> str | None:
    if not isinstance(item, dict):
        return None
    value = item.get(field)
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text[:max_length] if text else None


def _catalog_results(body: bytes) -> list[dict[str, Any]]:
    payload = _json(body)
    if payload.get("success") is not True or not isinstance(payload.get("results"), list):
        raise PricingError("TCGCSV catalog response was invalid")
    return [item for item in payload["results"] if isinstance(item, dict)]


class TCGCSVProvider:
    """Read TCGCSV's once-daily cached catalog and group price files.

    TCGCSV has no search endpoint. Discovery therefore fetches one bounded category/group
    payload on the server, filters product names there, and joins subtype names from that
    group's price file. The browser never contacts the provider or receives an unbounded
    response.
    """

    def __init__(
        self,
        get_bytes: Callable[..., bytes] | None = None,
        pause: Callable[[float], None] | None = None,
        clock: Callable[[], float] | None = None,
        catalog_cache_seconds: float = CATALOG_CACHE_SECONDS,
    ):
        self._get_bytes = get_bytes or _http_get
        self._pause = pause or time.sleep
        self._clock = clock or time.monotonic
        self._catalog_cache_seconds = catalog_cache_seconds
        self._catalog_cache: OrderedDict[
            tuple[object, ...], tuple[float, tuple[Any, ...]]
        ] = OrderedDict()
        self._catalog_lock = threading.Lock()
        self._catalog_request_lock = threading.Lock()
        self._catalog_slots = threading.BoundedSemaphore(MAX_CATALOG_CONCURRENT_REQUESTS)
        self._catalog_inflight: dict[tuple[object, ...], _CatalogFlight] = {}
        self._catalog_request_window_started = self._clock()
        self._catalog_request_count = 0
        self._prices_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self._price_errors: dict[tuple[str, str], PricingError] = {}

    def latest_update(self) -> FeedRevision:
        try:
            raw = self._get_bytes(TCGCSV_LAST_UPDATED_URL, accept="text/plain").decode("utf-8")
        except (UnicodeDecodeError, TypeError) as error:
            raise PricingError("provider update marker was invalid") from error
        marker = raw.strip()
        if not marker:
            raise PricingError("provider update marker was empty")
        return FeedRevision(marker[:120], _marker_date(marker))

    def _get_catalog(self, url: str) -> list[dict[str, Any]]:
        if not self._catalog_slots.acquire(timeout=HTTP_TIMEOUT_SECONDS):
            raise PricingError("TCGCSV catalog discovery is busy; retry shortly")
        try:
            # Only work that obtained an outbound slot consumes the daily allowance.
            # Timed-out queue waiters never contacted TCGCSV and must not exhaust it.
            self._reserve_catalog_request()
            self._pause(TCGCSV_REQUEST_DELAY_SECONDS)
            return _catalog_results(self._get_bytes(url))
        finally:
            self._catalog_slots.release()

    def _reserve_catalog_request(self) -> None:
        """Bound discovery traffic even when an authenticated client churns cache keys."""
        with self._catalog_request_lock:
            now = self._clock()
            if now - self._catalog_request_window_started >= CATALOG_CACHE_SECONDS:
                self._catalog_request_window_started = now
                self._catalog_request_count = 0
            if self._catalog_request_count >= MAX_CATALOG_REQUESTS_PER_DAY:
                raise PricingError("TCGCSV catalog discovery daily request limit was reached")
            self._catalog_request_count += 1

    def _cached_catalog(
        self, key: tuple[object, ...], loader: Callable[[], list[Any]]
    ) -> list[Any]:
        """Cache one bounded provider payload for a day across API requests.

        Catalog discovery is operator-facing and TCGCSV publishes once daily. Holding the
        small lock during a load prevents simultaneous browser requests from multiplying
        provider calls; price refreshes use separate per-run caches and are unaffected.
        """
        while True:
            with self._catalog_lock:
                cached = self._catalog_cache.get(key)
                now = self._clock()
                if cached is not None and cached[0] > now:
                    self._catalog_cache.move_to_end(key)
                    return list(cached[1])
                flight = self._catalog_inflight.get(key)
                if flight is None:
                    flight = _CatalogFlight(threading.Event())
                    self._catalog_inflight[key] = flight
                    break
            if not flight.event.wait(timeout=HTTP_TIMEOUT_SECONDS * 3):
                raise PricingError("TCGCSV catalog discovery timed out waiting for a load")
            if flight.error is not None:
                raise PricingError(str(flight.error)) from flight.error

        try:
            loaded = tuple(loader())
        except BaseException as error:
            with self._catalog_lock:
                self._catalog_inflight.pop(key, None)
                flight.error = (
                    error
                    if isinstance(error, PricingError)
                    else PricingError("TCGCSV catalog discovery failed")
                )
                flight.event.set()
            raise

        with self._catalog_lock:
            now = self._clock()
            expired = [
                cache_key
                for cache_key, value in self._catalog_cache.items()
                if value[0] <= now
            ]
            for cache_key in expired:
                self._catalog_cache.pop(cache_key, None)
            cached_items = sum(len(value[1]) for value in self._catalog_cache.values())
            while self._catalog_cache and (
                len(self._catalog_cache) >= MAX_CATALOG_CACHE_ENTRIES
                or cached_items + len(loaded) > MAX_CATALOG_CACHE_ITEMS
            ):
                _, removed = self._catalog_cache.popitem(last=False)
                cached_items -= len(removed[1])
            self._catalog_cache[key] = (now + self._catalog_cache_seconds, loaded)
            self._catalog_inflight.pop(key, None)
            flight.event.set()
            return list(loaded)

    @staticmethod
    def _validate_catalog_id(value: int, label: str) -> str:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise PricingError(f"TCGCSV {label} must be a positive integer")
        return str(value)

    def categories(self) -> list[CatalogCategory]:
        """Return a bounded list of TCGCSV categories for operator selection."""
        def load() -> list[CatalogCategory]:
            rows = self._get_catalog(TCGCSV_CATEGORIES_URL)
            categories: list[CatalogCategory] = []
            for item in rows[:MAX_CATALOG_CATEGORIES]:
                category_id = _catalog_id(item, "categoryId")
                name = _catalog_text(item, "name", max_length=120)
                display_name = _catalog_text(item, "displayName", max_length=160) or name
                if category_id is None or name is None or display_name is None:
                    continue
                categories.append(CatalogCategory(category_id, name, display_name))
            return categories

        return self._cached_catalog(("categories",), load)

    def groups(self, category_id: int) -> list[CatalogGroup]:
        """Return a bounded list of groups under one category."""
        category = self._validate_catalog_id(category_id, "category ID")
        def load() -> list[CatalogGroup]:
            rows = self._get_catalog(f"{TCGCSV_BASE_URL}/tcgplayer/{category}/groups")
            groups: list[CatalogGroup] = []
            for item in rows[:MAX_CATALOG_GROUPS]:
                group_id = _catalog_id(item, "groupId")
                item_category = _catalog_id(item, "categoryId") or category_id
                name = _catalog_text(item, "name", max_length=200)
                if group_id is None or item_category != category_id or name is None:
                    continue
                groups.append(
                    CatalogGroup(
                        group_id=group_id,
                        category_id=item_category,
                        name=name,
                        abbreviation=_catalog_text(item, "abbreviation", max_length=40),
                        published_on=_catalog_text(item, "publishedOn", max_length=40),
                    )
                )
            return groups

        return self._cached_catalog(("groups", category_id), load)

    def products(
        self, category_id: int, group_id: int, *, search: str | None = None, limit: int = 50
    ) -> list[CatalogProduct]:
        """Find products and their available printing/subtype names in one group."""
        category = self._validate_catalog_id(category_id, "category ID")
        group = self._validate_catalog_id(group_id, "group ID")
        if limit < 1 or limit > MAX_CATALOG_PRODUCTS:
            raise PricingError(
                f"TCGCSV product discovery is limited to {MAX_CATALOG_PRODUCTS} results"
            )

        def load() -> list[CatalogProduct]:
            product_rows = self._get_catalog(
                f"{TCGCSV_BASE_URL}/tcgplayer/{category}/{group}/products"
            )
            if len(product_rows) > MAX_CATALOG_INDEX_PRODUCTS:
                raise PricingError("TCGCSV product group was too large to index safely")
            try:
                if not self._catalog_slots.acquire(timeout=HTTP_TIMEOUT_SECONDS):
                    raise PricingError("TCGCSV catalog discovery is busy; retry shortly")
                try:
                    self._reserve_catalog_request()
                    price_rows = self._prices(category, group)
                finally:
                    self._catalog_slots.release()
                subtypes: dict[int, set[str]] = defaultdict(set)
                for item in price_rows:
                    product_id = _catalog_id(item, "productId")
                    subtype = _catalog_text(item, "subTypeName", max_length=80) or "Normal"
                    if product_id is not None:
                        subtypes.setdefault(product_id, set()).add(subtype)

                found: list[CatalogProduct] = []
                for item in product_rows:
                    product_id = _catalog_id(item, "productId")
                    item_category = _catalog_id(item, "categoryId") or category_id
                    item_group = _catalog_id(item, "groupId") or group_id
                    name = _catalog_text(item, "name", max_length=200)
                    if (
                        product_id is None
                        or item_category != category_id
                        or item_group != group_id
                        or name is None
                    ):
                        continue
                    found.append(
                        CatalogProduct(
                            product_id=product_id,
                            category_id=item_category,
                            group_id=item_group,
                            name=name,
                            clean_name=_catalog_text(item, "cleanName", max_length=200),
                            image_url=_catalog_text(item, "imageUrl", max_length=500),
                            url=_catalog_text(item, "url", max_length=500),
                            subtypes=tuple(
                                sorted(
                                    subtypes.get(product_id, {"Normal"}), key=str.casefold
                                )[:MAX_CATALOG_SUBTYPES]
                            ),
                        )
                    )
                return found
            finally:
                self.release_group(category, group)

        catalog = self._cached_catalog(("products", category_id, group_id), load)
        needle = " ".join((search or "").split()).casefold()
        found: list[CatalogProduct] = []
        for item in catalog:
            searchable = " ".join(
                value for value in (item.name, item.clean_name or "") if value
            ).casefold()
            if needle and needle not in searchable:
                continue
            found.append(item)
            if len(found) >= limit:
                break
        return found

    def _prices(self, category_id: str, group_id: str) -> list[dict[str, Any]]:
        if not category_id.isdigit() or not group_id.isdigit():
            raise PricingError("TCGCSV mapping has invalid category or group")
        key = (category_id, group_id)
        cached_error = self._price_errors.get(key)
        if cached_error is not None:
            raise cached_error
        if key not in self._prices_cache:
            try:
                # TCGCSV explicitly asks backend importers to leave 100 ms between files.
                # Refresh is a synchronous, member-triggered maintenance operation running in
                # FastAPI's threadpool, so this courtesy delay does not block the event loop.
                self._pause(TCGCSV_REQUEST_DELAY_SECONDS)
                url = f"{TCGCSV_BASE_URL}/tcgplayer/{category_id}/{group_id}/prices"
                payload = _json(self._get_bytes(url))
                if payload.get("success") is not True or not isinstance(
                    payload.get("results"), list
                ):
                    raise PricingError("TCGCSV price response was invalid")
                self._prices_cache[key] = [
                    item for item in payload["results"] if isinstance(item, dict)
                ]
            except PricingError as error:
                # Several local products can point at one group. Remember a bad response for
                # this refresh so they share one bounded network attempt too.
                feed_error = ProviderFeedError(str(error))
                self._price_errors[key] = feed_error
                raise feed_error from error
        return self._prices_cache[key]

    def release_group(self, category_id: str, group_id: str) -> None:
        """Release one group's potentially large payload after its mappings are processed."""
        key = (category_id, group_id)
        self._prices_cache.pop(key, None)
        self._price_errors.pop(key, None)

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
                original_value=_bounded_positive_decimal(
                    raw_price,
                    maximum=MAX_PROVIDER_MARKET_PRICE,
                    message="TCGCSV returned an invalid price",
                ),
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
                        rate=_bounded_positive_decimal(
                            raw_rate,
                            maximum=MAX_EXCHANGE_RATE,
                            message="Bank of Canada returned an invalid rate",
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
    #: Marker/FX failures prevent a meaningful refresh; a worker should retry and exit nonzero.
    systemic_failure: bool = False


def _acquire_refresh_lock(db: Session) -> None:
    """Serialize refreshes across web workers using a transaction-scoped PG lock."""
    get_bind = getattr(db, "get_bind", None)
    if get_bind is None:
        # Small unit-test doubles do not expose a SQLAlchemy bind. Real application sessions
        # always do, and production is deliberately PostgreSQL-only.
        return
    bind = get_bind()
    dialect_name = getattr(getattr(bind, "dialect", None), "name", None)
    if dialect_name != "postgresql":
        raise PricingError("Pricing refresh requires a PostgreSQL database")
    try:
        locked = db.execute(
            select(func.pg_try_advisory_xact_lock(PRICING_REFRESH_LOCK_KEY))
        ).scalar_one()
    except SQLAlchemyError as error:
        raise PricingError("Could not acquire the pricing refresh lock") from error
    if locked is not True:
        raise PricingRefreshBusy(
            "Another pricing refresh is already running; wait for it to finish and retry."
        )


def _refresh_group_key(mapping: CatalogMapping) -> tuple[str, str]:
    return (
        (mapping.external_category_id or "").strip(),
        (mapping.external_group_id or "").strip(),
    )


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
    _acquire_refresh_lock(db)
    reference = today or date.today()
    attempted_at = now or datetime.now(UTC)
    mappings = list(
        db.scalars(
            select(CatalogMapping)
            .where(CatalogMapping.match_status == MAPPING_CONFIRMED)
            .order_by(CatalogMapping.id)
            .limit(MAX_REFRESH_MAPPINGS + 1)
        )
    )
    if not mappings:
        return RefreshSummary(0, 0, 0, 0, 0, None, ())
    if len(mappings) > MAX_REFRESH_MAPPINGS:
        raise PricingRefreshLimitExceeded(
            f"Pricing refresh is limited to {MAX_REFRESH_MAPPINGS} confirmed mappings per run; "
            "disable unused mappings before retrying."
        )

    provider = provider or TCGCSVProvider()
    fx = fx or BankOfCanadaProvider()
    current_by_mapping = {
        quote.mapping_id: quote
        for quote in db.scalars(
            select(CurrentMarketQuote)
            .where(CurrentMarketQuote.mapping_id.in_([mapping.id for mapping in mappings]))
            .with_for_update()
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
            len(mappings), 0, 0, stale, unavailable, None, (message,), True
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

    pending_by_group: dict[tuple[str, str], list[CatalogMapping]] = defaultdict(list)
    for mapping in pending:
        pending_by_group[_refresh_group_key(mapping)].append(mapping)
    if len(pending_by_group) > MAX_REFRESH_GROUPS:
        raise PricingRefreshLimitExceeded(
            f"Pricing refresh is limited to {MAX_REFRESH_GROUPS} TCGCSV groups per run; "
            "disable or batch mappings before retrying."
        )

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
            len(mappings),
            0,
            skipped,
            stale,
            unavailable,
            revisions.value,
            (message,),
            True,
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
    provider_groups_attempted = provider_groups_failed = 0
    for group_key, group_mappings in pending_by_group.items():
        group_provider_attempted = False
        group_feed_failed = False
        try:
            for mapping in group_mappings:
                current = current_by_mapping.get(mapping.id)
                if not is_pricing_eligible(mapping.product):
                    message = eligibility_error(mapping.product)
                    _, had_value = _record_failure(db, mapping, current, attempted_at, message)
                    stale += int(had_value)
                    unavailable += int(not had_value)
                    errors.append(message)
                    continue
                try:
                    group_provider_attempted = True
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
                except ProviderFeedError as error:
                    group_feed_failed = True
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
                    current = CurrentMarketQuote(
                        mapping_id=mapping.id, product_id=mapping.product_id
                    )
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
        finally:
            if group_provider_attempted:
                provider_groups_attempted += 1
                provider_groups_failed += int(group_feed_failed)
            release_group = getattr(provider, "release_group", None)
            if callable(release_group):
                release_group(*group_key)

    db.flush()
    systemic_failure = (
        provider_groups_attempted > 0
        and provider_groups_failed == provider_groups_attempted
    )
    return RefreshSummary(
        len(mappings),
        refreshed,
        skipped,
        stale,
        unavailable,
        revisions.value,
        tuple(errors[:20]),
        systemic_failure,
    )


__all__ = [
    "BOC_USD_CAD_URL",
    "CatalogCategory",
    "CatalogGroup",
    "CatalogProduct",
    "CATALOG_PROVIDER_TCGCSV",
    "ELIGIBLE_PRODUCT_TYPE_SLUGS",
    "ExchangeRate",
    "FeedRevision",
    "HTTP_TIMEOUT_SECONDS",
    "MAX_EXCHANGE_RATE",
    "MAX_PROVIDER_MARKET_PRICE",
    "MAX_REFRESH_GROUPS",
    "MAX_REFRESH_MAPPINGS",
    "MAX_CATALOG_CATEGORIES",
    "MAX_CATALOG_GROUPS",
    "MAX_CATALOG_PRODUCTS",
    "MARKET_QUOTE_STALE_DAYS",
    "MarketEstimate",
    "PricingError",
    "PricingRefreshBusy",
    "PricingRefreshLimitExceeded",
    "PRICING_REFRESH_LOCK_KEY",
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
