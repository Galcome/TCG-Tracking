"""Tests for the private Railway Cron pricing worker."""

from contextlib import contextmanager

import pytest
from sqlalchemy.exc import SQLAlchemyError

from src.jobs import pricing_refresh as job
from src.services import pricing


class FakeDB:
    pass


def summary(*, systemic_failure=False, errors=()):
    return pricing.RefreshSummary(1, 1, 0, 0, 0, "revision", tuple(errors), systemic_failure)


def test_run_returns_success_and_keeps_item_warnings_visible(caplog):
    seen = []

    @contextmanager
    def database():
        yield FakeDB()

    def refresh(db):
        seen.append(db)
        return summary(errors=("one mapping unavailable",))

    result = job.run(refresh_fn=refresh, db_factory=database, sleep=seen.append)
    assert result.errors == ("one mapping unavailable",)
    assert len(seen) == 1
    assert "pricing_refresh_item_errors" in caplog.text


@pytest.mark.parametrize("attempts", [0, job.MAX_ATTEMPTS + 1])
def test_run_rejects_unbounded_attempt_configuration(attempts):
    with pytest.raises(ValueError, match="attempts"):
        job.run(attempts=attempts)


def test_run_retries_busy_lock_then_succeeds():
    outcomes = iter(
        [pricing.PricingRefreshBusy("busy"), pricing.PricingRefreshBusy("busy"), summary()]
    )
    delays = []

    def refresh(_db):
        outcome = next(outcomes)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    result = job.run(
        refresh_fn=refresh,
        db_factory=lambda: _database(),
        sleep=delays.append,
    )
    assert result.refreshed == 1
    assert delays == list(job.RETRY_DELAYS_SECONDS)


def test_run_retries_a_pricing_error_then_succeeds():
    outcomes = iter([pricing.PricingError("provider unavailable"), summary()])
    delays = []

    def refresh(_db):
        outcome = next(outcomes)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    result = job.run(
        refresh_fn=refresh,
        db_factory=lambda: _database(),
        sleep=delays.append,
    )
    assert result.refreshed == 1
    assert delays == [job.RETRY_DELAYS_SECONDS[0]]


def test_run_retries_systemic_failure_then_succeeds():
    outcomes = iter([summary(systemic_failure=True), summary()])
    delays = []

    def refresh(_db):
        return next(outcomes)

    result = job.run(refresh_fn=refresh, db_factory=lambda: _database(), sleep=delays.append)
    assert result.refreshed == 1
    assert delays == [job.RETRY_DELAYS_SECONDS[0]]


def test_run_retries_database_error_and_fails_after_bound():
    delays = []

    def refresh(_db):
        raise SQLAlchemyError("database unavailable")

    with pytest.raises(job.PricingJobError, match="after 2 attempts"):
        job.run(
            refresh_fn=refresh,
            db_factory=lambda: _database(),
            sleep=delays.append,
            attempts=2,
        )
    assert delays == [job.RETRY_DELAYS_SECONDS[0]]


def test_main_requires_worker_role(monkeypatch):
    monkeypatch.setattr(job.settings, "app_role", "api")
    assert job.main() == 2


def test_main_returns_failure_when_worker_exhausts_retries(monkeypatch):
    monkeypatch.setattr(job.settings, "app_role", "worker")
    monkeypatch.setattr(job, "run", lambda: (_ for _ in ()).throw(job.PricingJobError("bad")))
    assert job.main() == 1


def test_main_returns_success_for_worker(monkeypatch):
    monkeypatch.setattr(job.settings, "app_role", "worker")
    monkeypatch.setattr(job, "run", lambda: summary())
    assert job.main() == 0


@contextmanager
def _database():
    yield FakeDB()
