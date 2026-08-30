"""Unit coverage for the free pricing adapters and refresh state machine."""

import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from urllib.error import URLError

import pytest
from sqlalchemy.exc import SQLAlchemyError

from src.models.catalog import CatalogMapping
from src.models.market_price import CurrentMarketQuote, MarketPriceSnapshot
from src.services import pricing

TODAY = date(2026, 8, 29)
NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


def expect_pricing_error(callable_obj, message: str):
    with pytest.raises(pricing.PricingError, match=message):
        callable_obj()


class Response:
    def __init__(self, body: bytes, status: int = 200):
        self.body = body
        self.status = status
        self.read_size = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size):
        self.read_size = size
        return self.body


def test_http_get_sets_headers_and_bounds_response(monkeypatch):
    response = Response(b"ok")

    def open_url(request, timeout):
        assert request.headers["User-agent"] == pricing.USER_AGENT
        assert request.headers["Accept"] == "text/plain"
        assert timeout == pricing.HTTP_TIMEOUT_SECONDS
        return response

    monkeypatch.setattr(pricing, "urlopen", open_url)
    assert pricing._http_get("https://example.test", accept="text/plain") == b"ok"
    assert response.read_size == pricing.MAX_PROVIDER_RESPONSE_BYTES + 1


def test_http_get_rejects_bad_status_network_errors_and_large_body(monkeypatch):
    monkeypatch.setattr(pricing, "urlopen", lambda *_args, **_kwargs: Response(b"x", 503))
    expect_pricing_error(
        lambda: pricing._http_get("https://example.test"), "unsuccessful response"
    )

    def fails(*_args, **_kwargs):
        raise URLError("offline")

    monkeypatch.setattr(pricing, "urlopen", fails)
    expect_pricing_error(lambda: pricing._http_get("https://example.test"), "request failed")

    monkeypatch.setattr(
        pricing,
        "urlopen",
        lambda *_args, **_kwargs: Response(b"123"),
    )
    monkeypatch.setattr(pricing, "MAX_PROVIDER_RESPONSE_BYTES", 2)
    expect_pricing_error(lambda: pricing._http_get("https://example.test"), "too large")


def test_json_and_decimal_helpers_reject_untrusted_values():
    expect_pricing_error(lambda: pricing._json(b"not-json"), "invalid JSON")
    expect_pricing_error(lambda: pricing._json(b"[]"), "invalid payload")
    expect_pricing_error(lambda: pricing._decimal("NaN", message="bad"), "bad")
    expect_pricing_error(lambda: pricing._decimal("not-a-number", message="bad"), "bad")
    expect_pricing_error(lambda: pricing._decimal(-1, message="bad"), "bad")
    expect_pricing_error(lambda: pricing._positive_decimal(0, message="bad"), "bad")
    assert pricing._cents(Decimal("12.345")) == 1235
    assert pricing._normalise_subtype(None) == "normal"
    assert pricing._normalise_subtype(" Holofoil ") == "holofoil"
    expect_pricing_error(lambda: pricing._marker_date("yesterday"), "usable date")
    expect_pricing_error(lambda: pricing._marker_date("2026-02-31"), "usable date")
    assert pricing._marker_date("updated 2026-08-29T12:00:00Z") == TODAY


def test_pricing_helpers_reject_unusable_catalog_rows_and_currency_values():
    expect_pricing_error(lambda: pricing._cents(Decimal("NaN")), "out of range")
    expect_pricing_error(lambda: pricing._cents(Decimal("-0.01")), "out of range")
    assert pricing._catalog_id(None, "categoryId") is None
    assert pricing._catalog_id({"categoryId": True}, "categoryId") is None
    assert pricing._catalog_text(None, "name") is None
    expect_pricing_error(lambda: pricing._catalog_results(b'{}'), "catalog response")


def mapping(**overrides):
    values = {
        "id": uuid.uuid4(),
        "product_id": uuid.uuid4(),
        "provider": "tcgcsv",
        "external_product_id": "42",
        "external_group_id": "7",
        "external_category_id": "1",
        "subtype_name": "Normal",
        "condition": "Near Mint",
        "product": SimpleNamespace(
            product_type=SimpleNamespace(slug="booster-box"),
            grading_company=None,
            grade=None,
            cert_number=None,
        ),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_tcgcsv_provider_parses_marker_prices_and_caches_group():
    calls = []
    payload = {
        pricing.TCGCSV_LAST_UPDATED_URL: b"2026-08-29T06:00:00Z\n",
        f"{pricing.TCGCSV_BASE_URL}/tcgplayer/1/7/prices": json.dumps(
            {
                "success": True,
                "results": [
                    "ignored",
                    {"productId": 42, "subTypeName": "Normal", "marketPrice": "12.345"},
                    {"productId": 42, "subTypeName": "Holofoil", "marketPrice": "99"},
                ],
            }
        ).encode(),
    }

    def get_bytes(url, **_kwargs):
        calls.append(url)
        return payload[url]

    pauses = []
    provider = pricing.TCGCSVProvider(get_bytes, pause=pauses.append)
    revision = provider.latest_update()
    assert revision == pricing.FeedRevision("2026-08-29T06:00:00Z", TODAY)
    quote = provider.quote_for(mapping(), revision)
    assert quote.original_value == Decimal("12.345")
    assert quote.currency == "USD"
    # The second quote uses the in-memory group cache, so no second HTTP request occurs.
    assert provider.quote_for(mapping(subtype_name=" holoFOIL "), revision).original_value == 99
    assert calls == [
        pricing.TCGCSV_LAST_UPDATED_URL,
        f"{pricing.TCGCSV_BASE_URL}/tcgplayer/1/7/prices",
    ]
    assert pauses == [pricing.TCGCSV_REQUEST_DELAY_SECONDS]


def test_tcgcsv_catalog_discovery_filters_products_and_joins_subtypes():
    calls = []
    payload = {
        pricing.TCGCSV_CATEGORIES_URL: json.dumps(
            {
                "success": True,
                "results": [
                    {"categoryId": 3, "name": "Pokemon", "displayName": "Pokémon"},
                    {"categoryId": "bad", "name": "Ignored", "displayName": "Ignored"},
                ],
            }
        ).encode(),
        f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/groups": json.dumps(
            {
                "success": True,
                "results": [
                    {
                        "groupId": 3170,
                        "categoryId": 3,
                        "name": "Silver Tempest",
                        "abbreviation": "SIT",
                        "publishedOn": "2022-11-11T00:00:00",
                    },
                    {"groupId": 8, "categoryId": 2, "name": "Wrong category"},
                ],
            }
        ).encode(),
        f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/3170/products": json.dumps(
            {
                "success": True,
                "results": [
                    {
                        "productId": 1,
                        "categoryId": 3,
                        "groupId": 3170,
                        "name": "Lugia V",
                        "cleanName": "Lugia V",
                        "imageUrl": "https://example.test/lugia.jpg",
                    },
                    {
                        "productId": 2,
                        "categoryId": 3,
                        "groupId": 3170,
                        "name": "Lugia VSTAR",
                    },
                ],
            }
        ).encode(),
        f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/3170/prices": json.dumps(
            {
                "success": True,
                "results": [
                    {"productId": 1, "subTypeName": "Normal", "marketPrice": 4},
                    {"productId": 1, "subTypeName": "Holofoil", "marketPrice": 5},
                    {"productId": 2, "subTypeName": "Normal", "marketPrice": 6},
                ],
            }
        ).encode(),
    }

    def get_bytes(url, **_kwargs):
        calls.append(url)
        return payload[url]

    pauses = []
    provider = pricing.TCGCSVProvider(get_bytes, pause=pauses.append)
    assert provider.categories() == [pricing.CatalogCategory(3, "Pokemon", "Pokémon")]
    assert provider.groups(3) == [
        pricing.CatalogGroup(3170, 3, "Silver Tempest", "SIT", "2022-11-11T00:00:00")
    ]
    products = provider.products(3, 3170, search="lugia v", limit=5)
    assert products[0] == pricing.CatalogProduct(
        1,
        3,
        3170,
        "Lugia V",
        "Lugia V",
        "https://example.test/lugia.jpg",
        None,
        ("Holofoil", "Normal"),
    )
    assert products[1].product_id == 2
    assert calls == [
        pricing.TCGCSV_CATEGORIES_URL,
        f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/groups",
        f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/3170/products",
        f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/3170/prices",
    ]
    assert pauses == [pricing.TCGCSV_REQUEST_DELAY_SECONDS] * 4


def test_tcgcsv_catalog_discovery_caches_provider_payloads_until_ttl_expires():
    calls = []
    clock = [100.0]
    payload = json.dumps(
        {
            "success": True,
            "results": [{"categoryId": 3, "name": "Pokemon", "displayName": "Pokémon"}],
        }
    ).encode()

    def get_bytes(url, **_kwargs):
        calls.append(url)
        return payload

    provider = pricing.TCGCSVProvider(
        get_bytes,
        pause=lambda _seconds: None,
        clock=lambda: clock[0],
        catalog_cache_seconds=60,
    )
    assert provider.categories()[0].category_id == 3
    assert provider.categories()[0].category_id == 3
    assert calls == [pricing.TCGCSV_CATEGORIES_URL]

    clock[0] = 161.0
    assert provider.categories()[0].category_id == 3
    assert calls == [pricing.TCGCSV_CATEGORIES_URL, pricing.TCGCSV_CATEGORIES_URL]


def test_tcgcsv_catalog_rejects_a_request_when_all_provider_slots_are_busy():
    class BusySlots:
        def acquire(self, timeout):
            assert timeout == pricing.HTTP_TIMEOUT_SECONDS
            return False

        def release(self):
            raise AssertionError("a slot that was not acquired must not be released")

    provider = pricing.TCGCSVProvider(lambda *_args, **_kwargs: b"unused")
    provider._catalog_slots = BusySlots()

    expect_pricing_error(
        lambda: provider._get_catalog(pricing.TCGCSV_CATEGORIES_URL), "busy"
    )


def test_tcgcsv_catalog_request_window_resets_after_a_day():
    clock = [100.0]
    provider = pricing.TCGCSVProvider(
        lambda *_args, **_kwargs: b"unused",
        clock=lambda: clock[0],
    )
    provider._catalog_request_count = pricing.MAX_CATALOG_REQUESTS_PER_DAY

    clock[0] += pricing.CATALOG_CACHE_SECONDS
    provider._reserve_catalog_request()

    assert provider._catalog_request_window_started == clock[0]
    assert provider._catalog_request_count == 1


def test_tcgcsv_catalog_waiter_timeout_reports_a_bounded_failure():
    class StuckEvent:
        def wait(self, timeout):
            assert timeout == pricing.HTTP_TIMEOUT_SECONDS * 3
            return False

    provider = pricing.TCGCSVProvider(lambda *_args, **_kwargs: b"unused")
    provider._catalog_inflight[("categories",)] = pricing._CatalogFlight(StuckEvent())

    expect_pricing_error(provider.categories, "timed out waiting")


def test_tcgcsv_catalog_cache_and_daily_provider_work_are_strictly_bounded():
    provider = pricing.TCGCSVProvider(
        lambda _url, **_kwargs: b'{"success": true, "results": []}',
        pause=lambda _seconds: None,
    )
    for category_id in range(1, pricing.MAX_CATALOG_CACHE_ENTRIES + 2):
        provider.groups(category_id)
    assert len(provider._catalog_cache) == pricing.MAX_CATALOG_CACHE_ENTRIES
    assert ("groups", 1) not in provider._catalog_cache

    provider._catalog_request_count = pricing.MAX_CATALOG_REQUESTS_PER_DAY
    expect_pricing_error(provider.categories, "daily request limit")


def test_tcgcsv_catalog_cache_single_flights_the_same_key_without_global_network_lock():
    calls = []
    started = threading.Event()
    release = threading.Event()
    payload = b'{"success": true, "results": [{"categoryId": 3, "name": "Pokemon"}]}'

    def get_bytes(url, **_kwargs):
        calls.append(url)
        started.set()
        assert release.wait(timeout=2)
        return payload

    provider = pricing.TCGCSVProvider(get_bytes, pause=lambda _seconds: None)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(provider.categories)
        assert started.wait(timeout=1)
        second = executor.submit(provider.categories)
        release.set()
        assert first.result(timeout=2) == second.result(timeout=2)
    assert calls == [pricing.TCGCSV_CATEGORIES_URL]


def test_tcgcsv_catalog_queue_only_counts_requests_that_obtain_a_provider_slot():
    provider = pricing.TCGCSVProvider(
        lambda _url, **_kwargs: b'{"success": true, "results": []}',
        pause=lambda _seconds: None,
    )
    for _ in range(pricing.MAX_CATALOG_CONCURRENT_REQUESTS):
        assert provider._catalog_slots.acquire(timeout=0)

    with ThreadPoolExecutor(max_workers=1) as executor:
        waiting = executor.submit(provider.categories)
        # The worker is blocked on the outbound semaphore, before reserving quota.
        threading.Event().wait(0.05)
        assert provider._catalog_request_count == 0
        provider._catalog_slots.release()
        assert waiting.result(timeout=2) == []

    # Release the second slot retained by this test.
    provider._catalog_slots.release()
    assert provider._catalog_request_count == 1


def test_tcgcsv_catalog_single_flight_shares_provider_failures_with_waiters():
    calls = []
    started = threading.Event()
    release = threading.Event()

    def fail(url, **_kwargs):
        calls.append(url)
        started.set()
        assert release.wait(timeout=2)
        raise pricing.PricingError("provider unavailable")

    provider = pricing.TCGCSVProvider(fail, pause=lambda _seconds: None)
    with ThreadPoolExecutor(max_workers=1) as executor:
        leader = executor.submit(provider.categories)
        assert started.wait(timeout=1)
        release_timer = threading.Timer(0.05, release.set)
        release_timer.start()
        with pytest.raises(pricing.PricingError, match="provider unavailable"):
            provider.categories()
        with pytest.raises(pricing.PricingError, match="provider unavailable"):
            leader.result(timeout=2)
        release_timer.join(timeout=1)

    assert calls == [pricing.TCGCSV_CATEGORIES_URL]


def test_tcgcsv_catalog_caps_subtypes_and_rejects_oversized_product_indexes():
    products_url = f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/3170/products"
    prices_url = f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/3170/prices"
    payload = {
        products_url: json.dumps(
            {
                "success": True,
                "results": [
                    {"productId": 1, "categoryId": 3, "groupId": 3170, "name": "Card"}
                ],
            }
        ).encode(),
        prices_url: json.dumps(
            {
                "success": True,
                "results": [
                    {"productId": 1, "subTypeName": f"Printing {index}"}
                    for index in range(pricing.MAX_CATALOG_SUBTYPES + 5)
                ],
            }
        ).encode(),
    }
    provider = pricing.TCGCSVProvider(
        lambda url, **_kwargs: payload[url], pause=lambda _seconds: None
    )
    assert len(provider.products(3, 3170)[0].subtypes) == pricing.MAX_CATALOG_SUBTYPES

    provider = pricing.TCGCSVProvider(lambda *_args, **_kwargs: b"{}")
    provider._get_catalog = lambda _url: [
        {}
    ] * (pricing.MAX_CATALOG_INDEX_PRODUCTS + 1)
    expect_pricing_error(lambda: provider.products(3, 3170), "too large")


def test_tcgcsv_product_discovery_rejects_a_busy_price_slot():
    class BusySlots:
        def acquire(self, timeout):
            assert timeout == pricing.HTTP_TIMEOUT_SECONDS
            return False

        def release(self):
            raise AssertionError("a slot that was not acquired must not be released")

    provider = pricing.TCGCSVProvider(lambda *_args, **_kwargs: b"unused")
    provider._get_catalog = lambda _url: [
        {"productId": 1, "categoryId": 3, "groupId": 3170, "name": "Card"}
    ]
    provider._catalog_slots = BusySlots()

    expect_pricing_error(lambda: provider.products(3, 3170), "busy")


def test_tcgcsv_catalog_discovery_skips_invalid_and_nonmatching_rows_and_honors_limit():
    products_url = f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/3170/products"
    prices_url = f"{pricing.TCGCSV_BASE_URL}/tcgplayer/3/3170/prices"
    payload = {
        products_url: json.dumps(
            {
                "success": True,
                "results": [
                    "ignored",
                    {"productId": 1, "categoryId": 2, "groupId": 3170, "name": "Wrong"},
                    {"productId": 2, "categoryId": 3, "groupId": 3170, "name": "Other"},
                    {"productId": 3, "categoryId": 3, "groupId": 3170, "name": "Target"},
                ],
            }
        ).encode(),
        prices_url: json.dumps(
            {"success": True, "results": [{"productId": 3, "subTypeName": "Normal"}]}
        ).encode(),
    }
    provider = pricing.TCGCSVProvider(
        lambda url, **_kwargs: payload[url], pause=lambda _seconds: None
    )
    assert [item.product_id for item in provider.products(3, 3170, search="target")] == [3]
    assert provider.products(3, 3170, search="other", limit=1)[0].product_id == 2
    provider = pricing.TCGCSVProvider(
        lambda url, **_kwargs: payload[url], pause=lambda _seconds: None
    )
    assert provider.products(3, 3170, limit=1)[0].product_id == 2


def test_tcgcsv_catalog_discovery_rejects_invalid_ids_and_limits():
    provider = pricing.TCGCSVProvider(lambda *_args, **_kwargs: b"{}")
    expect_pricing_error(lambda: provider.groups(0), "positive integer")
    expect_pricing_error(lambda: provider.groups(True), "positive integer")
    expect_pricing_error(
        lambda: provider.products(1, 2, limit=pricing.MAX_CATALOG_PRODUCTS + 1), "limited"
    )


def test_tcgcsv_provider_rejects_bad_marker_group_payload_and_missing_quote():
    expect_pricing_error(
        lambda: pricing.TCGCSVProvider(lambda *_args, **_kwargs: b" ").latest_update(),
        "marker was empty",
    )
    expect_pricing_error(
        lambda: pricing.TCGCSVProvider(lambda *_args, **_kwargs: b"not a date").latest_update(),
        "usable date",
    )
    expect_pricing_error(
        lambda: pricing.TCGCSVProvider(lambda *_args, **_kwargs: b"\xff").latest_update(),
        "marker was invalid",
    )

    provider = pricing.TCGCSVProvider(lambda *_args, **_kwargs: b"{}")
    expect_pricing_error(lambda: provider._prices("x", "7"), "invalid category")

    bad_payloads = [b'{"success": false, "results": []}', b'{"success": true}']
    for body in bad_payloads:
        provider = pricing.TCGCSVProvider(lambda *_args, body=body, **_kwargs: body)
        expect_pricing_error(lambda: provider._prices("1", "7"), "price response")

    provider = pricing.TCGCSVProvider(
        lambda *_args, **_kwargs: json.dumps(
            {"success": True, "results": [{"productId": "1", "marketPrice": None}]}
        ).encode()
    )
    revision = pricing.FeedRevision("r", TODAY)
    expect_pricing_error(
        lambda: provider.quote_for(mapping(external_product_id="1"), revision),
        "no market price",
    )
    expect_pricing_error(
        lambda: provider.quote_for(mapping(external_product_id="999"), revision),
        "no matching price",
    )


def test_tcgcsv_provider_rejects_invalid_price():
    for raw_price in ("NaN", "0", "-1", "1000001"):
        provider = pricing.TCGCSVProvider(
            lambda *_args, raw_price=raw_price, **_kwargs: json.dumps(
                {
                    "success": True,
                    "results": [{"productId": "42", "marketPrice": raw_price}],
                }
            ).encode()
        )
        expect_pricing_error(
            lambda: provider.quote_for(mapping(), pricing.FeedRevision("r", TODAY)),
            "invalid price",
        )


def test_tcgcsv_provider_memoizes_group_failures_and_releases_payload():
    calls = []
    url = f"{pricing.TCGCSV_BASE_URL}/tcgplayer/1/7/prices"

    def get_bytes(requested_url, **_kwargs):
        calls.append(requested_url)
        return b'{"success": false, "results": []}'

    provider = pricing.TCGCSVProvider(get_bytes, pause=lambda _seconds: None)
    revision = pricing.FeedRevision("r", TODAY)
    for _ in range(2):
        expect_pricing_error(
            lambda: provider.quote_for(mapping(), revision), "price response was invalid"
        )
    assert calls == [url]

    provider.release_group("1", "7")
    expect_pricing_error(
        lambda: provider.quote_for(mapping(), revision), "price response was invalid"
    )
    assert calls == [url, url]


def test_bank_of_canada_chooses_latest_valid_observation_and_validates_rate():
    body = json.dumps(
        {
            "observations": [
                None,
                {"d": "bad", "FXUSDCAD": {"v": "1.1"}},
                {"d": "2026-08-20", "FXUSDCAD": {"v": "1.30"}},
                {"d": "2026-08-28", "FXUSDCAD": {"v": "1.36"}},
                {"d": "2026-09-01", "FXUSDCAD": {"v": "1.50"}},
                {"d": "2026-08-27", "FXUSDCAD": {}},
            ]
        }
    ).encode()
    provider = pricing.BankOfCanadaProvider(lambda *_args, **_kwargs: body)
    rate = provider.usd_cad(TODAY)
    assert rate == pricing.ExchangeRate(Decimal("1.36"), date(2026, 8, 28))

    invalid = pricing.BankOfCanadaProvider(
        lambda *_args, **_kwargs: b'{"observations":[{"d":"2026-08-29","FXUSDCAD":{"v":"0"}}]}'
    )
    expect_pricing_error(lambda: invalid.usd_cad(TODAY), "invalid rate")
    invalid = pricing.BankOfCanadaProvider(
        lambda *_args, **_kwargs: (_ for _ in ()).throw(pricing.PricingError("request failed"))
    )
    expect_pricing_error(lambda: invalid.usd_cad(TODAY), "request")


def test_bank_of_canada_rejects_invalid_or_empty_payloads():
    provider = pricing.BankOfCanadaProvider(lambda *_args, **_kwargs: b"{}")
    expect_pricing_error(lambda: provider.usd_cad(TODAY), "response was invalid")
    provider = pricing.BankOfCanadaProvider(lambda *_args, **_kwargs: b'{"observations": []}')
    expect_pricing_error(lambda: provider.usd_cad(TODAY), "no recent")


def test_pricing_eligibility_is_strict_about_slabs_and_product_types():
    raw = mapping()
    assert pricing.is_pricing_eligible(raw.product)
    raw.product.grading_company = "PSA"
    assert not pricing.is_pricing_eligible(raw.product)
    assert pricing.eligibility_error(raw.product) == "Market pricing is manual for graded products."

    graded = mapping(product=SimpleNamespace(product_type=SimpleNamespace(slug="graded-card")))
    assert not pricing.is_pricing_eligible(graded.product)
    assert pricing.eligibility_error(graded.product) == (
        "Market pricing is manual for graded products."
    )

    unsupported = mapping(
        product=SimpleNamespace(product_type=SimpleNamespace(slug="booster-pack"))
    )
    assert not pricing.is_pricing_eligible(unsupported.product)
    assert "raw cards" in pricing.eligibility_error(unsupported.product)


class ScalarRows:
    def __init__(self, rows):
        self.rows = rows

    def __iter__(self):
        return iter(self.rows)


class FakeDB:
    def __init__(self, mappings=(), currents=(), history=()):
        self.mappings = list(mappings)
        self.currents = list(currents)
        self.history = list(history)
        self.added = []
        self.flushes = 0

    def scalars(self, statement):
        model = statement.column_descriptions[0]["entity"]
        if model is CatalogMapping:
            return ScalarRows(self.mappings)
        if model is CurrentMarketQuote:
            return ScalarRows(self.currents)
        if model is MarketPriceSnapshot:
            return ScalarRows(self.history)
        raise AssertionError(model)

    def add(self, item):
        self.added.append(item)
        if isinstance(item, CurrentMarketQuote):
            self.currents.append(item)
        if isinstance(item, MarketPriceSnapshot):
            self.history.append(item)

    def flush(self):
        self.flushes += 1

    def execute(self, _statement):
        return []


class ScalarOne:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value


class LockedFakeDB(FakeDB):
    def __init__(self, locked, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.locked = locked
        self.lock_calls = 0

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

    def execute(self, _statement):
        self.lock_calls += 1
        return ScalarOne(self.locked)


class FakeProvider:
    def __init__(self, revision=None, quotes=None, marker_error=None):
        self.revision = revision or pricing.FeedRevision("r", TODAY)
        self.quotes = quotes or {}
        self.marker_error = marker_error
        self.quote_calls = []
        self.release_calls = []

    def latest_update(self):
        if self.marker_error:
            raise self.marker_error
        return self.revision

    def quote_for(self, item, revision):
        self.quote_calls.append(item.id)
        result = self.quotes[item.id]
        if isinstance(result, BaseException):
            raise result
        return pricing.ProviderQuote(Decimal(str(result)), "USD", revision)

    def release_group(self, category_id, group_id):
        self.release_calls.append((category_id, group_id))


class FakeFX:
    def __init__(self, rate=Decimal("1.35"), error=None):
        self.rate = rate
        self.error = error
        self.calls = []

    def usd_cad(self, on_or_before):
        self.calls.append(on_or_before)
        if self.error:
            raise self.error
        return pricing.ExchangeRate(self.rate, on_or_before)


def test_refresh_uses_transaction_lock_and_rejects_concurrent_run():
    db = LockedFakeDB(False)
    with pytest.raises(pricing.PricingRefreshBusy, match="already running"):
        pricing.refresh(db, today=TODAY, now=NOW, provider=FakeProvider(), fx=FakeFX())
    assert db.lock_calls == 1


def test_refresh_lock_requires_postgres_and_surfaces_lock_query_errors():
    class NonPostgresDB(FakeDB):
        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))

    with pytest.raises(pricing.PricingError, match="PostgreSQL"):
        pricing._acquire_refresh_lock(NonPostgresDB())

    class BrokenDB(FakeDB):
        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def execute(self, _statement):
            raise SQLAlchemyError("lock query failed")

    with pytest.raises(pricing.PricingError, match="acquire"):
        pricing._acquire_refresh_lock(BrokenDB())


def test_refresh_rejects_mapping_limit_before_provider_work():
    db = FakeDB([mapping() for _ in range(pricing.MAX_REFRESH_MAPPINGS + 1)])
    provider = FakeProvider()
    with pytest.raises(pricing.PricingRefreshLimitExceeded, match="confirmed mappings"):
        pricing.refresh(db, today=TODAY, now=NOW, provider=provider, fx=FakeFX())
    assert provider.quote_calls == []


def test_refresh_rejects_group_limit_before_fx_work():
    mappings = [
        mapping(external_group_id=str(group_id))
        for group_id in range(pricing.MAX_REFRESH_GROUPS + 1)
    ]
    db = FakeDB(mappings)
    fx = FakeFX()
    with pytest.raises(pricing.PricingRefreshLimitExceeded, match="TCGCSV groups"):
        pricing.refresh(db, today=TODAY, now=NOW, provider=FakeProvider(), fx=fx)
    assert fx.calls == []


def test_current_estimates_empty_and_prefers_first_product_quote():
    db = FakeDB()
    assert pricing.current_estimates(db, []) == {}
    product_id = uuid.uuid4()
    first = SimpleNamespace(
        product_id=product_id,
        cad_value_cents=1234,
        source_as_of=TODAY,
        status="fresh",
        source_revision="r1",
    )
    second = SimpleNamespace(
        product_id=product_id,
        cad_value_cents=9999,
        source_as_of=TODAY,
        status="fresh",
        source_revision="r2",
    )
    enabled = SimpleNamespace(provider="tcgcsv", product=mapping().product)
    db.execute = lambda _statement: [(first, enabled), (second, enabled)]
    result = pricing.current_estimates(db, [product_id], today=TODAY)
    assert result[product_id].value_cents == 1234
    assert pricing.current_estimates(db, today=TODAY) == result


def test_current_estimate_becomes_stale_when_refresh_is_old():
    product_id = uuid.uuid4()
    quote = SimpleNamespace(
        product_id=product_id,
        cad_value_cents=1234,
        source_as_of=TODAY - timedelta(days=pricing.MARKET_QUOTE_STALE_DAYS + 1),
        status="fresh",
        source_revision="old",
    )
    db = FakeDB()
    db.execute = lambda _statement: [
        (quote, SimpleNamespace(provider="tcgcsv", product=mapping().product))
    ]
    assert pricing.current_estimates(db, [product_id], today=TODAY)[product_id].status == "stale"


def test_current_estimate_hides_old_raw_quote_after_product_becomes_graded():
    product_id = uuid.uuid4()
    quote = SimpleNamespace(
        product_id=product_id,
        cad_value_cents=1234,
        source_as_of=TODAY,
        status="fresh",
        source_revision="r",
    )
    product = SimpleNamespace(
        product_type=SimpleNamespace(slug="graded-card"),
        grading_company="PSA",
        grade="10",
        cert_number="123",
    )
    mapping_row = SimpleNamespace(provider="tcgcsv", product=product)
    db = FakeDB()
    db.execute = lambda _statement: [(quote, mapping_row)]
    assert pricing.current_estimates(db, [product_id], today=TODAY) == {}


def test_refresh_without_mappings_does_no_network_work():
    db = FakeDB()
    provider = FakeProvider()
    summary = pricing.refresh(db, today=TODAY, now=NOW, provider=provider, fx=FakeFX())
    assert summary == pricing.RefreshSummary(0, 0, 0, 0, 0, None, ())
    assert provider.quote_calls == []


def test_refresh_marks_every_mapping_unavailable_or_stale_when_marker_fails():
    old = CurrentMarketQuote(
        mapping_id=uuid.uuid4(), product_id=uuid.uuid4(), cad_value_cents=100, status="fresh"
    )
    with_value = mapping(id=old.mapping_id, product_id=old.product_id)
    without_value = mapping()
    db = FakeDB([with_value, without_value], [old])
    summary = pricing.refresh(
        db,
        today=TODAY,
        now=NOW,
        provider=FakeProvider(marker_error=pricing.PricingError("feed down")),
        fx=FakeFX(),
    )
    assert (summary.attempted, summary.stale, summary.unavailable) == (2, 1, 1)
    assert old.status == "stale"
    assert any(item.mapping_id == without_value.id for item in db.currents)
    assert db.flushes == 1


def test_refresh_skips_same_revision_only_after_successful_refresh_today():
    item = mapping()
    current = CurrentMarketQuote(
        mapping_id=item.id,
        product_id=item.product_id,
        status="fresh",
        source_revision="r",
        last_successful_at=NOW,
    )
    provider = FakeProvider()
    fx = FakeFX()
    summary = pricing.refresh(
        FakeDB([item], [current]), today=TODAY, now=NOW, provider=provider, fx=fx
    )
    assert summary.skipped == 1
    assert summary.refreshed == 0
    assert fx.calls == []


def test_refresh_marks_pending_stale_when_fx_fails():
    item = mapping()
    current = CurrentMarketQuote(
        mapping_id=item.id, product_id=item.product_id, cad_value_cents=100, status="fresh"
    )
    db = FakeDB([item], [current])
    summary = pricing.refresh(
        db,
        today=TODAY,
        now=NOW,
        provider=FakeProvider(),
        fx=FakeFX(error=pricing.PricingError("fx down")),
    )
    assert (summary.stale, summary.unavailable, summary.skipped) == (1, 0, 0)
    assert current.status == "stale"


def test_refresh_writes_current_quote_and_history_and_rounds_cad():
    item = mapping()
    db = FakeDB([item])
    provider = FakeProvider(quotes={item.id: "12.345"})
    summary = pricing.refresh(
        db, today=TODAY, now=NOW, provider=provider, fx=FakeFX(Decimal("1.35"))
    )
    assert (summary.refreshed, summary.stale, summary.unavailable) == (1, 0, 0)
    current = db.currents[0]
    assert current.original_value_cents == 1235
    assert current.cad_value_cents == 1667
    assert current.fx_as_of == TODAY
    assert current.status == "fresh"
    assert len(db.history) == 1
    assert db.history[0].source_revision == "r"
    assert db.history[0].fx_as_of == TODAY


def test_refresh_handles_ineligible_unavailable_and_provider_errors():
    ineligible = mapping(
        product=SimpleNamespace(
            product_type=SimpleNamespace(slug="graded-card"),
            grading_company="PSA",
            grade="10",
            cert_number="123",
        )
    )
    unavailable = mapping()
    provider_error = mapping()
    db = FakeDB([ineligible, unavailable, provider_error])
    provider = FakeProvider(
        quotes={
            unavailable.id: pricing.QuoteUnavailable("no quote"),
            provider_error.id: pricing.PricingError("bad quote"),
        }
    )
    summary = pricing.refresh(db, today=TODAY, now=NOW, provider=provider, fx=FakeFX())
    assert summary.refreshed == 0
    assert summary.unavailable == 3
    assert len(summary.errors) == 3
    assert len(db.currents) == 3


def test_refresh_marks_complete_group_feed_outage_systemic_for_worker_retry():
    first = mapping(external_group_id="1")
    second = mapping(external_group_id="2")
    provider = FakeProvider(
        quotes={
            first.id: pricing.ProviderFeedError("group feed unavailable"),
            second.id: pricing.ProviderFeedError("group feed unavailable"),
        }
    )
    summary = pricing.refresh(
        FakeDB([first, second]), today=TODAY, now=NOW, provider=provider, fx=FakeFX()
    )
    assert summary.refreshed == 0
    assert summary.unavailable == 2
    assert summary.systemic_failure is True


def test_refresh_does_not_mark_isolated_missing_product_as_systemic():
    item = mapping()
    provider = FakeProvider(
        quotes={item.id: pricing.QuoteUnavailable("no market price")}
    )
    summary = pricing.refresh(
        FakeDB([item]), today=TODAY, now=NOW, provider=provider, fx=FakeFX()
    )
    assert summary.unavailable == 1
    assert summary.systemic_failure is False


def test_refresh_keeps_daily_fx_change_out_of_history_until_monthly_checkpoint():
    item = mapping()
    current = CurrentMarketQuote(
        mapping_id=item.id,
        product_id=item.product_id,
        status="stale",
        cad_value_cents=100,
        source_revision="old",
        last_successful_at=NOW - timedelta(days=1),
    )
    previous = MarketPriceSnapshot(
        mapping_id=item.id,
        product_id=item.product_id,
        provider="tcgcsv",
        external_product_id="42",
        subtype_name="Normal",
        condition="Near Mint",
        original_currency="USD",
        original_value_cents=100,
        cad_value_cents=100,
        fx_rate=Decimal("1.0"),
        fx_as_of=TODAY - timedelta(days=1),
        source_revision="old",
        source_as_of=TODAY - timedelta(days=1),
        captured_on=TODAY - timedelta(days=1),
        fetched_at=NOW - timedelta(days=1),
    )
    db = FakeDB([item], [current], [previous])
    summary = pricing.refresh(
        db,
        today=TODAY,
        now=NOW,
        provider=FakeProvider(quotes={item.id: "1.00"}),
        fx=FakeFX(Decimal("1.35")),
    )
    assert summary.refreshed == 1
    assert current.status == "fresh"
    assert len(db.history) == 1

    next_month = date(2026, 9, 1)
    later = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    summary = pricing.refresh(
        db,
        today=next_month,
        now=later,
        provider=FakeProvider(
            revision=pricing.FeedRevision("next", next_month),
            quotes={item.id: "1.00"},
        ),
        fx=FakeFX(Decimal("1.36")),
    )
    assert summary.refreshed == 1
    assert len(db.history) == 2


def test_refresh_compares_against_newest_history_row():
    item = mapping()

    def snapshot(value: int, captured_on: date) -> MarketPriceSnapshot:
        return MarketPriceSnapshot(
            mapping_id=item.id,
            product_id=item.product_id,
            provider="tcgcsv",
            external_product_id="42",
                subtype_name="Normal",
                condition="Near Mint",
            original_currency="USD",
            original_value_cents=value,
            cad_value_cents=value,
            fx_rate=Decimal("1.0"),
            fx_as_of=captured_on,
            source_revision=captured_on.isoformat(),
            source_as_of=captured_on,
            captured_on=captured_on,
            fetched_at=datetime.combine(captured_on, datetime.min.time(), tzinfo=UTC),
        )

    newest = snapshot(100, date(2026, 8, 28))
    oldest = snapshot(50, date(2026, 8, 1))
    db = FakeDB([item], history=[newest, oldest])
    pricing.refresh(
        db,
        today=TODAY,
        now=NOW,
        provider=FakeProvider(quotes={item.id: "1.00"}),
        fx=FakeFX(Decimal("1.35")),
    )
    assert db.history == [newest, oldest]
