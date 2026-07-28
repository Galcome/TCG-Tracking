"""Application settings loaded and validated automatically from .env."""

from urllib.parse import quote, urlparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_env: str = "development"
    app_role: str = "api"
    debug: bool = False
    database_url: str
    direct_database_url: str | None = None
    direct_db_password: str | None = None
    db_pool_size: int = 4
    db_max_overflow: int = 2
    db_pool_timeout_seconds: int = 15
    db_pool_recycle_seconds: int = 270

    # Supabase auth token verification.
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_jwt_secret: str

    # CORS. "*" is allowed for local/dev only.
    allowed_origins: str = "*"
    allowed_origin_regex: str = ""

    # Sentry.
    sentry_dsn: str = ""

    def resolved_direct_database_url(self) -> str | None:
        """Return a direct Supabase Postgres URL without hardcoding project refs."""
        if self.direct_database_url:
            return self.direct_database_url
        if not self.direct_db_password:
            return None

        host = urlparse(self.supabase_url).hostname or ""
        project_ref = host.split(".", 1)[0] if host.endswith(".supabase.co") else ""
        if not project_ref:
            return None

        password = quote(self.direct_db_password)
        return f"postgresql+psycopg://postgres:{password}@db.{project_ref}.supabase.co:5432/postgres"

    @field_validator("database_url")
    @classmethod
    def ensure_psycopg3_scheme(cls, value: str) -> str:
        """SQLAlchemy needs postgresql+psycopg:// for the psycopg v3 driver."""
        db_url = value.strip().strip("'").strip('"')
        if db_url.startswith("DATABASE_URL="):
            db_url = db_url.replace("DATABASE_URL=", "", 1)
        if db_url.startswith("postgresql://"):
            return db_url.replace("postgresql://", "postgresql+psycopg://", 1)
        if db_url.startswith("postgres://"):
            return db_url.replace("postgres://", "postgresql+psycopg://", 1)
        return db_url

    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug(cls, value: object) -> object:
        """Accept common deployment-style strings for boolean debug flags."""
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production"}:
                return False
            if normalized in {"dev", "debug", "development"}:
                return True
        return value

    @field_validator("app_role")
    @classmethod
    def validate_app_role(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"api", "worker", "combined", "test"}:
            raise ValueError("app_role must be one of: api, worker, combined, test")
        return normalized

    @model_validator(mode="after")
    def validate_prod_cors(self) -> "Settings":
        origins = {origin.strip() for origin in self.allowed_origins.split(",")}
        if self.app_env == "production" and "*" in origins:
            raise ValueError("ALLOWED_ORIGINS cannot include '*' in production.")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def cors_origin_regex(self) -> str | None:
        regex = self.allowed_origin_regex.strip()
        return regex or None

    @property
    def docs_enabled(self) -> bool:
        return self.app_env != "production"


settings = Settings()
