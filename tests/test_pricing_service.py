"""Unit coverage for the free pricing adapters and refresh state machine."""

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from urllib.error import URLError

import pytest

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
    provider = pricing.TCGCSVProvider(
        lambda *_args, **_kwargs: json.dumps(
            {"success": True, "results": [{"productId": "42", "marketPrice": "NaN"}]}
        ).encode()
    )
    expect_pricing_error(
        lambda: provider.quote_for(mapping(), pricing.FeedRevision("r", TODAY)),
        "invalid price",
    )


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


class FakeProvider:
    def __init__(self, revision=None, quotes=None, marker_error=None):
        self.revision = revision or pricing.FeedRevision("r", TODAY)
        self.quotes = quotes or {}
        self.marker_error = marker_error
        self.quote_calls = []

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
