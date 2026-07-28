"""
Pytest configuration.

Sets required environment variables before any src modules are imported,
so tests can run without a local .env file.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("APP_ROLE", "test")
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("DIRECT_DATABASE_URL", "")
os.environ.setdefault("DIRECT_DB_PASSWORD", "")
os.environ.setdefault("DB_POOL_SIZE", "4")
os.environ.setdefault("DB_MAX_OVERFLOW", "2")
os.environ.setdefault("DB_POOL_TIMEOUT_SECONDS", "15")
os.environ.setdefault("DB_POOL_RECYCLE_SECONDS", "270")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-supabase-jwt-secret-for-local-testing")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8081")
os.environ.setdefault("ALLOWED_ORIGIN_REGEX", "")
os.environ.setdefault("SENTRY_DSN", "")
