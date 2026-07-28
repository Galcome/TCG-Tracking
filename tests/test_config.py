"""Tests for application settings and validators."""

import pytest

from src.config import Settings

BASE = {"database_url": "postgresql://user:pass@localhost/db", "firebase_project_id": "proj-123"}


def make_settings(**overrides) -> Settings:
    return Settings(**{**BASE, **overrides})


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("postgresql://user:pass@localhost/db", "postgresql+psycopg://user:pass@localhost/db"),
        ("postgres://user:pass@localhost/db", "postgresql+psycopg://user:pass@localhost/db"),
        (
            "postgresql+psycopg://user:pass@localhost/db",
            "postgresql+psycopg://user:pass@localhost/db",
        ),
        (
            "DATABASE_URL=postgresql://user:pass@localhost/db",
            "postgresql+psycopg://user:pass@localhost/db",
        ),
        ("'postgresql://user:pass@localhost/db'", "postgresql+psycopg://user:pass@localhost/db"),
    ],
)
def test_database_url_is_normalised_to_the_psycopg3_scheme(raw: str, expected: str):
    assert make_settings(database_url=raw).database_url == expected


def test_direct_database_url_is_normalised_too():
    settings = make_settings(direct_database_url="postgres://direct.example/db")
    assert settings.direct_database_url == "postgresql+psycopg://direct.example/db"


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_blank_direct_database_url_becomes_none(blank: str | None):
    assert make_settings(direct_database_url=blank).direct_database_url is None


def test_firebase_issuer_is_derived_from_project_id():
    settings = make_settings(firebase_project_id="tcg-tracking")
    assert settings.firebase_issuer == "https://securetoken.google.com/tcg-tracking"


def test_settings_rejects_invalid_app_role():
    with pytest.raises(ValueError):
        make_settings(app_role="spaceship")


def test_settings_accepts_known_app_role_case_insensitively():
    assert make_settings(app_role="  WORKER ").app_role == "worker"


def test_settings_rejects_wildcard_cors_in_production():
    with pytest.raises(ValueError):
        make_settings(
            app_env="production", allowed_origins="*", allowed_member_emails="a@example.com"
        )


def test_settings_allows_explicit_cors_in_production():
    settings = make_settings(
        app_env="production",
        allowed_origins="https://app.example.com",
        allowed_member_emails="a@example.com",
    )
    assert settings.cors_origins == ["https://app.example.com"]


def test_production_requires_a_member_allowlist():
    """Google sign-in is enabled, so an empty allowlist would admit any Google account."""
    with pytest.raises(ValueError, match="ALLOWED_MEMBER_EMAILS"):
        make_settings(app_env="production", allowed_origins="https://app.example.com")


def test_member_allowlist_is_normalised():
    settings = make_settings(allowed_member_emails=" Patrick@Example.com , jason@ex.com ,, ")
    assert settings.member_email_allowlist == {"patrick@example.com", "jason@ex.com"}


def test_member_allowlist_is_empty_outside_production():
    assert make_settings().member_email_allowlist == set()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("production", False), ("prod", False), ("release", False), ("development", True)],
)
def test_settings_normalizes_debug_strings(raw: str, expected: bool):
    assert make_settings(debug=raw).debug is expected


def test_settings_passes_through_real_booleans_for_debug():
    assert make_settings(debug=True).debug is True


def test_cors_origins_splits_and_strips():
    settings = make_settings(allowed_origins="https://a.example, https://b.example ,")
    assert settings.cors_origins == ["https://a.example", "https://b.example"]


def test_cors_origin_regex_is_none_when_blank():
    assert make_settings(allowed_origin_regex="   ").cors_origin_regex is None


def test_cors_origin_regex_is_returned_when_set():
    assert make_settings(allowed_origin_regex="^https://.*$").cors_origin_regex == "^https://.*$"


def test_docs_are_enabled_outside_production():
    assert make_settings(app_env="development").docs_enabled is True


def test_docs_are_disabled_in_production():
    settings = make_settings(
        app_env="production",
        allowed_origins="https://a.example",
        allowed_member_emails="a@example.com",
    )
    assert settings.docs_enabled is False
