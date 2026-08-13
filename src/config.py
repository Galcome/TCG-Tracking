"""Application settings loaded and validated automatically from .env."""

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # extra="ignore" because .env is shared with docker-compose, which reads its own
    # keys (POSTGRES_HOST_PORT) from the same file. Required settings still fail loudly
    # when absent; this only tolerates keys the app does not claim.
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_env: str = "development"
    app_role: str = "api"
    debug: bool = False

    # Runtime traffic uses the Neon pooled endpoint (the "-pooler" hostname).
    # DIRECT_DATABASE_URL is the unpooled endpoint, for Alembic and admin tasks.
    database_url: str
    direct_database_url: str | None = None

    # Firebase Auth token verification. ID tokens are RS256, signed by Google.
    firebase_project_id: str

    # Who may use the store ledger. Comma-separated emails, case-insensitive.
    #
    # Google sign-in is enabled on the Firebase project, so *any* Google account can
    # obtain a structurally valid token for it. A valid token proves identity, not
    # membership - this list is what proves membership. Empty means "allow any
    # authenticated user", which is refused in production by the validator below.
    allowed_member_emails: str = ""

    # CORS. "*" is allowed for local/dev only.
    allowed_origins: str = "*"
    allowed_origin_regex: str = ""

    # Sentry.
    sentry_dsn: str = ""

    #: Reads card names off a photo on the rip screen. Optional: with no key the
    #: button is simply absent and every screen works exactly as it does now.
    gemini_api_key: str = ""

    @field_validator("database_url", "direct_database_url")
    @classmethod
    def ensure_psycopg3_scheme(cls, value: str | None) -> str | None:
        """SQLAlchemy needs postgresql+psycopg:// for the psycopg v3 driver."""
        if value is None:
            return None
        db_url = value.strip().strip("'").strip('"')
        if not db_url:
            return None
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

    @model_validator(mode="after")
    def validate_prod_member_allowlist(self) -> "Settings":
        if self.app_env == "production" and not self.member_email_allowlist:
            raise ValueError(
                "ALLOWED_MEMBER_EMAILS must list the store's members in production. "
                "Google sign-in is enabled, so without it any Google account could "
                "sign in and provision itself as a member."
            )
        return self

    @property
    def member_email_allowlist(self) -> set[str]:
        return {
            email.strip().lower()
            for email in self.allowed_member_emails.split(",")
            if email.strip()
        }

    @property
    def firebase_issuer(self) -> str:
        """The `iss` claim Firebase stamps on every ID token for this project."""
        return f"https://securetoken.google.com/{self.firebase_project_id}"

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
