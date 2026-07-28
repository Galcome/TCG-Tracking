"""Tests for application settings and validators."""

import pytest

from src.config import Settings


def test_database_url_converted_to_psycopg3_scheme():
    s = Settings(
        database_url="postgresql://user:pass@localhost/db",
        supabase_url="https://test.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
    )
    assert s.database_url.startswith("postgresql+psycopg://")


def test_database_url_strips_pasted_assignment_prefix():
    s = Settings(
        database_url="DATABASE_URL=postgresql://user:pass@localhost/db",
        supabase_url="https://test.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
    )
    assert s.database_url == "postgresql+psycopg://user:pass@localhost/db"


def test_database_url_unchanged_when_already_correct_scheme():
    s = Settings(
        database_url="postgresql+psycopg://user:pass@localhost/db",
        supabase_url="https://test.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
    )
    assert s.database_url == "postgresql+psycopg://user:pass@localhost/db"


def test_database_url_converts_postgres_scheme_alias():
    s = Settings(
        database_url="postgres://user:pass@localhost/db",
        supabase_url="https://test.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
    )
    assert s.database_url == "postgresql+psycopg://user:pass@localhost/db"


def test_settings_derives_direct_database_url_from_supabase_project_ref():
    s = Settings(
        database_url="postgresql://pooled.example/db",
        supabase_url="https://newprojectref.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
        direct_db_password="p@ss word",
    )

    assert (
        s.resolved_direct_database_url()
        == "postgresql+psycopg://postgres:p%40ss%20word@db.newprojectref.supabase.co:5432/postgres"
    )


def test_settings_prefers_explicit_direct_database_url():
    s = Settings(
        database_url="postgresql://pooled.example/db",
        direct_database_url="postgresql+psycopg://direct.example/db",
        direct_db_password="p@ss word",
        supabase_url="https://newprojectref.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
    )

    assert s.resolved_direct_database_url() == "postgresql+psycopg://direct.example/db"


def test_settings_returns_none_without_direct_database_password():
    s = Settings(
        database_url="postgresql://pooled.example/db",
        supabase_url="https://newprojectref.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
    )

    assert s.resolved_direct_database_url() is None


def test_settings_returns_none_for_non_supabase_url():
    s = Settings(
        database_url="postgresql://pooled.example/db",
        supabase_url="https://example.com",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
        direct_db_password="p@ss word",
    )

    assert s.resolved_direct_database_url() is None


def test_settings_rejects_invalid_app_role():
    with pytest.raises(ValueError):
        Settings(
            database_url="postgresql://user:pass@localhost/db",
            supabase_url="https://test.supabase.co",
            supabase_anon_key="test-anon-key",
            supabase_jwt_secret="test-secret",
            app_role="spaceship",
        )


def test_settings_rejects_wildcard_cors_in_production():
    with pytest.raises(ValueError):
        Settings(
            database_url="postgresql://user:pass@localhost/db",
            supabase_url="https://test.supabase.co",
            supabase_anon_key="test-anon-key",
            supabase_jwt_secret="test-secret",
            app_env="production",
            allowed_origins="*",
        )


def test_settings_normalizes_debug_strings():
    prod = Settings(
        database_url="postgresql://user:pass@localhost/db",
        supabase_url="https://test.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
        debug="production",
    )
    dev = Settings(
        database_url="postgresql://user:pass@localhost/db",
        supabase_url="https://test.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_jwt_secret="test-secret",
        debug="development",
    )
    assert prod.debug is False
    assert dev.debug is True
