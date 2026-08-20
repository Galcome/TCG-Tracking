"""Application entry point - FastAPI app."""

import logging
import re
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.config import settings
from src.database import check_connection
from src.routes.api_v1 import router as api_v1_router

logger = logging.getLogger(__name__)
# Railway sleeps this service after roughly ten minutes idle and Neon suspends its compute
# alongside it, so the first request after a quiet spell spends about a second waiting on the
# database to come back. At 750ms every request in the first dashboard load tripped this and
# ten warnings arrived saying nothing except "nobody has used the app for a while". Three
# seconds is above a cold Neon resume and still below anything genuinely pathological.
SLOW_REQUEST_THRESHOLD_MS = 3000.0
REQUEST_ID_HEADER = "X-Request-ID"
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")

if settings.sentry_dsn:  # pragma: no cover
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        send_default_pii=False,
        traces_sample_rate=0.2,
    )


def _request_id_from_headers(request: Request) -> str:
    incoming = request.headers.get(REQUEST_ID_HEADER, "").strip()
    if incoming and REQUEST_ID_PATTERN.fullmatch(incoming):
        return incoming
    return f"api-{uuid4().hex[:16]}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    logger.info("Starting [env=%s role=%s]", settings.app_env, settings.app_role)
    yield
    logger.info("Shutdown complete.")


def create_app() -> FastAPI:
    app = FastAPI(
        title="TCG Card Investments",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Accept",
            "baggage",
            "sentry-trace",
            "X-Request-ID",
        ],
    )

    app.include_router(api_v1_router)

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        started_at = perf_counter()
        request_id = _request_id_from_headers(request)
        sentry_sdk.set_tag("request_id", request_id)
        sentry_sdk.set_tag("http.method", request.method)
        sentry_sdk.set_tag("http.route", request.url.path)
        response = await call_next(request)
        duration_ms = (perf_counter() - started_at) * 1000
        response.headers[REQUEST_ID_HEADER] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        if settings.app_env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Process-Time-Ms"] = f"{duration_ms:.2f}"
        if duration_ms >= SLOW_REQUEST_THRESHOLD_MS:
            logger.warning(
                "Slow request: method=%s path=%s status=%s duration_ms=%.2f",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
                extra={"request_id": request_id},
            )
        return response

    @app.get("/health", tags=["infra"])
    def health():
        """Health check - polled by Railway and load balancers."""
        if not check_connection():
            return JSONResponse(
                status_code=503,
                content={"status": "error", "detail": "database unreachable"},
            )
        return {"status": "ok"}

    return app


app = create_app()
